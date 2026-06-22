using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.UI.Modules.Path.Tasks;

public class GenerateUnitTask : AITaskBase
{
    private readonly string _pathId;
    private readonly string _unitId;
    private readonly IAIOrchestrator _orchestrator;
    private readonly ILearningPathService _pathService;
    private readonly ILoggerService _logger;

    public override string DisplayName => "Generating Learning Unit";

    public GenerateUnitTask(
        string pathId,
        string unitId,
        IAIOrchestrator orchestrator,
        ILearningPathService pathService,
        ILoggerService logger)
    {
        _pathId = pathId;
        _unitId = unitId;
        _orchestrator = orchestrator;
        _pathService = pathService;
        _logger = logger;

        _steps.Add(new GenerateUnitStep(this));
    }

    private class GenerateUnitStep : IAITaskStep
    {
        private readonly GenerateUnitTask _parent;
        public string Id { get; } = Guid.NewGuid().ToString();
        public string DisplayName { get; private set; } = "Generating Unit";
        public string Description { get; private set; } = "Creating detailed content.";
        public AITaskStatus Status { get; private set; } = AITaskStatus.Pending;
        public double Progress { get; private set; } = 0;
        public string? ErrorMessage { get; private set; }

        public GenerateUnitStep(GenerateUnitTask parent) => _parent = parent;

        public async Task<Result> ExecuteAsync(CancellationToken ct)
        {
            Status = AITaskStatus.Running;
            Progress = 0.1;

            try
            {
                var path = await _parent._pathService.GetPathAsync(_parent._pathId);
                var unit = path?.Units.FirstOrDefault(u => u.UnitId == _parent._unitId);

                if (path == null || unit == null) return Result.Failure("Unit or Path not found.");

                DisplayName = $"Generating: {unit.Title}";
                Description = unit.Goal;

                Progress = 0.3;

                var systemPrompt = @"You are a friendly, patient, and encouraging tutor.
Generate educational content for the specific unit following these rules:
1. Unit Introduction (Clear, learner-friendly)
2. Why This Topic Matters (Relevance before definitions, real-world intuition)
3. Conceptual Introduction (Informal, metaphors, no formulas yet)
4. Formal Explanation (Definitions, LaTeX for math if needed)
5. Interpretation & Understanding (What it means, address confusion)
6. What to Remember (Short recap, intuition focus)

IMPORTANT: Do NOT include a title or heading (# Title) at the top of your response. The unit title is already provided and displayed separately. Start directly with the content.

Tone: Assume learner is capable but new. Never shame.
Formatting: Use Markdown headings and short paragraphs; use LaTeX only for complex math, strictly wrapped in $ (inline) or $$ (block) delimiters (e.g., $ \frac{a}{b} $), and never as raw text. White space is key.
Avoid: Tool instructions, academic-only language, dense formula blocks without explanation.";

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
                    var path = await _parent._pathService.GetPathAsync(_parent._pathId);
                    var unit = path?.Units.FirstOrDefault(u => u.UnitId == _parent._unitId);
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
