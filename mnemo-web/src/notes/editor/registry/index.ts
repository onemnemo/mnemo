/**
 * The internal block registry.
 *
 * Adding a block type is one module plus one line in the list the schema layer assembles.
 * That is a promise about this editor's internals, not a plugin API: a new wire
 * type still needs backend persistence, export, import and migration handling
 * on the C# side, and a contract test proves it has them.
 */

export { buildBlockRegistry, defineBlockModule } from './build';
export type {
  BlockRegistry,
  BuildOptions,
  CommandEntry,
  HeightEstimator,
  InputTriggerEntry,
  InvariantEntry,
  RealizedViewFactory,
  SlashEntry,
} from './build';

export { RegistryValidationError, validateRegistry } from './validate';
export type { RegistryInput, RegistryIssue, ValidateOptions } from './validate';

export { commonBlockAttrs, commonBlockAttrNames } from './types';
export type {
  AiSegment,
  AiSegmentKind,
  AnyBlockModule,
  AnyMarkModule,
  BlockModule,
  BlockProjection,
  BlockSchema,
  BlockShellHost,
  CommandContribution,
  Dispatch,
  EditorServices,
  EstimateContext,
  InlineModule,
  InputTriggerContribution,
  InvariantContext,
  InvariantContribution,
  MarkModule,
  MdContext,
  MdToken,
  RealizedBlockView,
  RealizedBlockViewArgs,
  RealizedBlockViewFactory,
  SerializeContext,
  SlashContribution,
  SlashGroup,
} from './types';
