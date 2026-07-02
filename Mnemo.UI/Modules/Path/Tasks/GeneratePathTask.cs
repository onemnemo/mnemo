using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Schemas;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.UI.Modules.Path.Tasks;

public class GeneratePathTask : AITaskBase
{
    private readonly string _topic;
    private readonly string _instructions;
    private readonly string[] _filePaths;
    private readonly IAIOrchestrator _orchestrator;
    private readonly ILearningPathService _pathService;
    private readonly ILoggerService _logger;

    private LearningPath? _generatedPath;
    public LearningPath? GeneratedPath => _generatedPath;

    public override string DisplayName => $"Generating Learning Path: {_topic}";

    public GeneratePathTask(
        string topic,
        string instructions,
        string[] filePaths,
        IAIOrchestrator orchestrator,
        ILearningPathService pathService,
        ILoggerService logger)
    {
        _topic = topic;
        _instructions = instructions;
        _filePaths = filePaths;
        _orchestrator = orchestrator;
        _pathService = pathService;
        _logger = logger;

        _steps.Add(new GenerateStructureStep(this));
    }

    public async Task AddUnitGenerationStepsAsync()
    {
        if (_generatedPath == null) return;

        foreach (var unit in _generatedPath.Units)
        {
            if (unit.Status != AITaskStatus.Completed)
            {
                unit.Status = AITaskStatus.Running;
                _steps.Add(new GenerateUnitContentStep(this, _generatedPath.PathId, unit.UnitId));
            }
        }

        await _pathService.SavePathAsync(_generatedPath);
    }

    /// <summary>Reads file contents and returns them as a single combined string for inline context.</summary>
    private static async Task<string?> ReadFilesAsInlineContextAsync(string[] filePaths, int maxCharsPerFile, int maxTotalChars, CancellationToken ct)
    {
        if (filePaths.Length == 0) return null;
        var sb = new StringBuilder();
        int total = 0;
        foreach (var path in filePaths)
        {
            if (total >= maxTotalChars) break;
            if (!File.Exists(path)) continue;
            try
            {
                var content = await File.ReadAllTextAsync(path, ct).ConfigureAwait(false);
                var take = Math.Min(content.Length, Math.Min(maxCharsPerFile, maxTotalChars - total));
                sb.AppendLine($"--- File: {System.IO.Path.GetFileName(path)} ---");
                sb.AppendLine(take < content.Length ? content.AsSpan(0, take).ToString() + "\n\n[Content truncated.]" : content);
                sb.AppendLine();
                total += take;
            }
            catch
            {
                // Skip unreadable files
            }
        }
        return sb.Length > 0 ? sb.ToString() : null;
    }

    private class GenerateStructureStep : IAITaskStep
    {
        private readonly GeneratePathTask _parent;
        public string Id { get; } = Guid.NewGuid().ToString();
        public string DisplayName => "Designing Path Structure";
        public string Description => "Analyzing materials and creating units.";
        public AITaskStatus Status { get; private set; } = AITaskStatus.Pending;
        public double Progress { get; private set; } = 0;
        public string? ErrorMessage { get; private set; }

        public GenerateStructureStep(GeneratePathTask parent) => _parent = parent;

        private static string ExtractJson(string input)
        {
            if (string.IsNullOrWhiteSpace(input)) return string.Empty;

            var match = System.Text.RegularExpressions.Regex.Match(
                input,
                @"```(?:json)?\s*([\s\S]*?)\s*```",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (match.Success)
            {
                var extracted = match.Groups[1].Value.Trim();
                if (!string.IsNullOrEmpty(extracted) && extracted.StartsWith("{"))
                    return extracted;
            }

            int startIndex = input.IndexOf('{');
            int endIndex = input.LastIndexOf('}');

            if (startIndex != -1 && endIndex != -1 && endIndex > startIndex)
                return input.Substring(startIndex, endIndex - startIndex + 1).Trim();

            return input.Trim();
        }

        public async Task<Result> ExecuteAsync(CancellationToken ct)
        {
            Status = AITaskStatus.Running;
            Progress = 0.1;

            try
            {
                var pathScopeId = Guid.NewGuid().ToString();

                // Read uploaded files inline and fold into the prompt
                var fileContext = await ReadFilesAsInlineContextAsync(_parent._filePaths, 4000, 16000, ct).ConfigureAwait(false);

                Progress = 0.3;

                var systemPrompt = @"You are an expert curriculum designer. Generate a comprehensive learning path. Respond only with a JSON object. No conversational text before or after. Use forward slashes for any paths in strings.

CRITICAL title rules (follow exactly):
- Learning path ""title"": must be short, clean and concise — maximum 4 words (e.g. ""Introduction to Python"" or ""Data Structures Basics"").
- Each unit ""title"": maximum 3–5 words, short and clear (e.g. ""Variables and Types"", ""First Program"").";

                var userPromptBuilder = new StringBuilder();
                userPromptBuilder.AppendLine($"Create a learning path for the topic: '{_parent._topic}'");
                userPromptBuilder.AppendLine($"Additional instructions: {_parent._instructions}");
                if (!string.IsNullOrEmpty(fileContext))
                {
                    userPromptBuilder.AppendLine();
                    userPromptBuilder.AppendLine("Reference materials:");
                    userPromptBuilder.AppendLine(fileContext);
                }

                Progress = 0.4;

                var aiResult = await _parent._orchestrator.PromptStructuredAsync(
                    systemPrompt,
                    userPromptBuilder.ToString(),
                    LearningPathJsonSchema.GetSchema(),
                    ct);

                if (!aiResult.IsSuccess || aiResult.Value == null)
                    return Result.Failure(aiResult.ErrorMessage ?? "AI failed to respond.");

                var json = ExtractJson(aiResult.Value);

                var jsonOptions = new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true,
                    AllowTrailingCommas = true,
                    ReadCommentHandling = JsonCommentHandling.Skip
                };
                try
                {
                    _parent._generatedPath = JsonSerializer.Deserialize<LearningPath>(json, jsonOptions);
                }
                catch (JsonException ex)
                {
                    _parent._logger.Error("PathGen", $"JSON Parsing failed. Raw: {aiResult.Value}");
                    return Result.Failure($"Failed to parse generated path structure: {ex.Message}. The AI response was not valid JSON.", ex);
                }

                if (_parent._generatedPath == null) return Result.Failure("Failed to parse generated path structure.");

                _parent._generatedPath.PathId = pathScopeId;
                _parent._generatedPath.Title = string.IsNullOrWhiteSpace(_parent._generatedPath.Title) ? _parent._topic : _parent._generatedPath.Title;
                _parent._generatedPath.Metadata.Model = "AI Assistant";

                await _parent._pathService.SavePathAsync(_parent._generatedPath);
                await _parent.AddUnitGenerationStepsAsync();

                Progress = 1.0;
                Status = AITaskStatus.Completed;
                return Result.Success();
            }
            catch (Exception ex)
            {
                ErrorMessage = ex.Message;
                Status = AITaskStatus.Failed;
                return Result.Failure(ex.Message, ex);
            }
        }
    }

    private class GenerateUnitContentStep : IAITaskStep
    {
        private readonly GeneratePathTask _parent;
        private readonly string _pathId;
        private readonly string _unitId;
        public string Id { get; } = Guid.NewGuid().ToString();
        public string DisplayName { get; private set; } = "Generating Unit";
        public string Description { get; private set; } = "Creating unit content.";
        public AITaskStatus Status { get; private set; } = AITaskStatus.Pending;
        public double Progress { get; private set; } = 0;
        public string? ErrorMessage { get; private set; }

        public GenerateUnitContentStep(GeneratePathTask parent, string pathId, string unitId)
        {
            _parent = parent;
            _pathId = pathId;
            _unitId = unitId;
        }

        public async Task<Result> ExecuteAsync(CancellationToken ct)
        {
            Status = AITaskStatus.Running;
            Progress = 0.1;

            try
            {
                var path = await _parent._pathService.GetPathAsync(_pathId);
                var unit = path?.Units.FirstOrDefault(u => u.UnitId == _unitId);

                if (path == null || unit == null) return Result.Failure("Unit or Path not found.");

                DisplayName = $"Generating: {unit.Title}";
                Description = unit.Goal;

                Progress = 0.3;

                var systemPrompt = @"You are a friendly, patient, and encouraging tutor.
Generate educational content for the specific unit following these rules:
1. Why This Topic Matters (Relevance before definitions, real-world intuition)
2. Conceptual Introduction (Informal, metaphors, no formulas yet)
3. Formal Explanation (Definitions, LaTeX for math if needed)
4. Interpretation & Understanding (What it means, address confusion)
5. What to Remember (Short recap, intuition focus)

Tone: Assume learner is capable but new. Never shame.
Formatting: Markdown, short paragraphs, LaTeX only when needed (wrapped in $ (inline) or $$ (block) delimiters). Whitespace is key.
Avoid: Tool instructions, academic-only language, dense formula blocks without explanation, never include a title or heading at the top of your response.";

                var userPrompt = $@"Learning Path: {path.Title}
Current Unit: {unit.Title}
Goal: {unit.Goal}
Focus: {string.Join(", ", unit.GenerationHints.Focus)}
Avoid: {string.Join(", ", unit.GenerationHints.Avoid)}
Prerequisites: {string.Join(", ", unit.GenerationHints.Prerequisites)}";

                var aiResult = await _parent._orchestrator.PromptAsync(systemPrompt, userPrompt, ct);
                if (!aiResult.IsSuccess) return Result.Failure(aiResult.ErrorMessage!);

                unit.Content = aiResult.Value;
                unit.IsCompleted = true;
                unit.Status = AITaskStatus.Completed;

                await _parent._pathService.SavePathAsync(path);

                Progress = 1.0;
                Status = AITaskStatus.Completed;
                return Result.Success();
            }
            catch (Exception ex)
            {
                ErrorMessage = ex.Message;
                Status = AITaskStatus.Failed;

                try
                {
                    var path = await _parent._pathService.GetPathAsync(_pathId);
                    var unit = path?.Units.FirstOrDefault(u => u.UnitId == _unitId);
                    if (unit != null)
                    {
                        unit.Status = AITaskStatus.Failed;
                        await _parent._pathService.SavePathAsync(path!);
                    }
                }
                catch { /* Ignore secondary errors */ }

                return Result.Failure(ex.Message, ex);
            }
        }
    }
}
