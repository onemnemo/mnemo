export const areas = {
  notes: {
    aliases: ["note", "editor", "clipboard"],
    layers: {
      web: ["mnemo-web/src/notes/", "mnemo-web/src/peek/"],
      host: ["Mnemo.Host/Notes/"],
      core: ["Mnemo.Core/Services/INote"],
      infrastructure: ["Mnemo.Infrastructure/Services/Notes/", "Mnemo.Infrastructure/Services/NoteService.cs"],
      tests: ["Mnemo.Host.Tests/Notes/", "Mnemo.Infrastructure.Tests/Notes/"],
    },
    start: [
      "mnemo-web/src/notes/api.ts",
      "Mnemo.Host/Notes/NoteEndpoints.cs",
      "Mnemo.Core/Services/INoteService.cs",
      "Mnemo.Infrastructure/Services/NoteService.cs",
    ],
  },
  flashcards: {
    aliases: ["cards", "study", "scheduler"],
    layers: {
      web: ["mnemo-web/src/flashcards/"],
      host: ["Mnemo.Host/Flashcards/"],
      core: ["Mnemo.Core/Models/Flashcards/", "Mnemo.Core/Services/IFlashcard"],
      infrastructure: ["Mnemo.Infrastructure/Services/Flashcards/"],
      tests: ["Mnemo.Host.Tests/Flashcards/", "Mnemo.Infrastructure.Tests/Flashcards/"],
    },
    start: [
      "mnemo-web/src/flashcards/api.ts",
      "Mnemo.Host/Flashcards/CardEndpoints.cs",
      "Mnemo.Core/Services/IFlashcardCardService.cs",
      "Mnemo.Infrastructure/Services/Flashcards/FlashcardCardService.cs",
    ],
  },
  mindmap: {
    aliases: ["map", "canvas"],
    layers: {
      web: ["mnemo-web/src/mindmap/"],
      host: ["Mnemo.Host/Mindmap/"],
      core: ["Mnemo.Core/Models/Mindmap/", "Mnemo.Core/Services/IMindmap"],
      infrastructure: ["Mnemo.Infrastructure/Services/Mindmap/"],
      tests: ["Mnemo.Host.Tests/Mindmap/", "Mnemo.Infrastructure.Tests/Mindmap/"],
    },
    start: [
      "mnemo-web/src/mindmap/api.ts",
      "Mnemo.Host/Mindmap/MindmapEndpoints.cs",
      "Mnemo.Core/Services/IMindmapService.cs",
      "Mnemo.Infrastructure/Services/Mindmap/MindmapDocumentService.cs",
    ],
  },
  trash: {
    aliases: ["restore", "recycle"],
    layers: {
      web: ["mnemo-web/src/trash/"],
      host: ["Mnemo.Host/Trash/"],
      core: ["Mnemo.Core/Models/Trash/", "Mnemo.Core/Services/ITrash"],
      infrastructure: [
        "Mnemo.Infrastructure/Services/Trash/",
        "Mnemo.Infrastructure/Services/Flashcards/Trash/",
        "Mnemo.Infrastructure/Services/Mindmap/Trash/",
        "Mnemo.Infrastructure/Services/Notes/Trash/",
      ],
      tests: ["Mnemo.Host.Tests/Trash/", "Mnemo.Infrastructure.Tests/Trash/"],
    },
    start: [
      "mnemo-web/src/trash/api.ts",
      "Mnemo.Host/Trash/TrashEndpoints.cs",
      "Mnemo.Core/Services/ITrashService.cs",
      "Mnemo.Infrastructure/Services/Trash/TrashService.cs",
    ],
  },
  backup: {
    aliases: ["profile-backup", "profile-restore"],
    layers: {
      web: ["mnemo-web/src/settings/backup-api.ts", "mnemo-web/src/profile/"],
      host: ["Mnemo.Host/Backup/"],
      core: ["Mnemo.Core/Services/IProfileBackup"],
      infrastructure: ["Mnemo.Infrastructure/Services/ProfileBackup/"],
      tests: ["Mnemo.Host.Tests/Backup/", "Mnemo.Infrastructure.Tests/ProfileBackup/"],
    },
    start: [
      "mnemo-web/src/settings/backup-api.ts",
      "Mnemo.Host/Backup/ProfileBackupEndpoints.cs",
      "Mnemo.Core/Services/IProfileBackupService.cs",
      "Mnemo.Infrastructure/Services/ProfileBackup/ProfileBackupService.cs",
    ],
  },
  proofing: {
    aliases: ["spelling", "spellcheck"],
    layers: {
      web: ["mnemo-web/src/notes/proofing/", "mnemo-web/src/notes/edit/useSpellcheck.ts"],
      host: ["Mnemo.Host/Proofing/"],
      core: ["Mnemo.Core/Models/Proofing/", "Mnemo.Core/Services/Proofing/"],
      infrastructure: ["Mnemo.Infrastructure/Modules/Proofing/", "Mnemo.Infrastructure/Services/Spellcheck/"],
      tests: ["Mnemo.Host.Tests/Proofing/", "Mnemo.Infrastructure.Tests/Proofing/"],
    },
    start: [
      "mnemo-web/src/notes/proofing/client.ts",
      "Mnemo.Host/Proofing/ProofingEndpoints.cs",
      "Mnemo.Core/Services/Proofing/IProofingService.cs",
      "Mnemo.Infrastructure/Modules/Proofing/ProofingService.cs",
    ],
  },
  statistics: {
    aliases: ["stats", "overview"],
    layers: {
      web: ["mnemo-web/src/overview/"],
      host: ["Mnemo.Host/Statistics/", "Mnemo.Host/Overview/"],
      core: ["Mnemo.Core/Models/Statistics/", "Mnemo.Core/Services/IStatisticsManager.cs"],
      infrastructure: ["Mnemo.Infrastructure/Services/Statistics/"],
      tests: ["Mnemo.Host.Tests/Statistics/", "Mnemo.Infrastructure.Tests/Statistics/"],
    },
    start: [
      "mnemo-web/src/overview/api.ts",
      "Mnemo.Host/Statistics/StatisticsEndpoints.cs",
      "Mnemo.Core/Services/IStatisticsManager.cs",
      "Mnemo.Infrastructure/Services/Statistics/StatisticsManager.cs",
    ],
  },
  search: {
    aliases: ["find"],
    layers: {
      web: ["mnemo-web/src/search/"],
      host: ["Mnemo.Host/Flashcards/SearchEndpoints.cs"],
      core: ["Mnemo.Core/Services/Search/"],
      infrastructure: ["Mnemo.Infrastructure/Services/Search/"],
      tests: ["Mnemo.Host.Tests/Search/"],
    },
    start: [
      "mnemo-web/src/search/useSearchPool.ts",
      "Mnemo.Host/Flashcards/SearchEndpoints.cs",
      "Mnemo.Core/Services/Search/IGlobalSearchService.cs",
      "Mnemo.Infrastructure/Services/Search/GlobalSearchService.cs",
    ],
  },
  ai: {
    aliases: ["chat", "tools"],
    layers: {
      web: ["mnemo-web/src/chat/"],
      host: ["Mnemo.Host/Ai/", "Mnemo.Host/Chat/"],
      core: ["Mnemo.Core/Models/Ai/", "Mnemo.Core/Services/Ai/", "Mnemo.Core/Services/IAI"],
      infrastructure: ["Mnemo.Infrastructure/Services/AI/"],
      tests: ["Mnemo.Host.Tests/Ai/", "Mnemo.Infrastructure.Tests/Ai/"],
    },
    start: [
      "mnemo-web/src/chat/api.ts",
      "Mnemo.Host/Ai/AiEndpoints.cs",
      "Mnemo.Core/Services/Ai/IAiToolGateway.cs",
    ],
  },
  settings: {
    aliases: ["preferences"],
    layers: {
      web: ["mnemo-web/src/settings/"],
      host: ["Mnemo.Host/Settings/"],
      core: ["Mnemo.Core/Services/ISettings"],
      infrastructure: ["Mnemo.Infrastructure/Services/SettingsService.cs"],
    },
    start: [
      "mnemo-web/src/settings/api.ts",
      "Mnemo.Host/Settings/SettingsEndpoints.cs",
      "Mnemo.Infrastructure/Services/SettingsService.cs",
    ],
  },
  updates: {
    aliases: ["release-update"],
    layers: {
      web: ["mnemo-web/src/updates/"],
      host: ["Mnemo.Host/Updates/"],
      infrastructure: ["Mnemo.Infrastructure/Services/Updates/"],
      tests: ["Mnemo.Host.Tests/Updates/"],
    },
    start: [
      "mnemo-web/src/updates/api.ts",
      "Mnemo.Host/Updates/UpdateEndpoints.cs",
      "Mnemo.Infrastructure/Services/Updates/VelopackUpdateService.cs",
    ],
  },
  shell: {
    aliases: ["chrome", "startup", "navigation"],
    layers: {
      web: ["mnemo-web/src/app/", "mnemo-web/src/nav/", "mnemo-web/src/pages/"],
      host: ["Mnemo.Host/Program.cs", "Mnemo.Host/Chrome/", "Mnemo.Host/Startup/", "Mnemo.Host/Web/", "Mnemo.Host/Lifecycle/"],
      tests: ["Mnemo.Host.Tests/Chrome/", "Mnemo.Host.Tests/Startup/", "Mnemo.Host.Tests/Web/"],
    },
    start: [
      "mnemo-web/src/app/routes.tsx",
      "Mnemo.Host/Program.cs",
      "Mnemo.Host/Startup/WindowSizing.cs",
    ],
  },
};
