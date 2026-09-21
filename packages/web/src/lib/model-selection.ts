import {
  DEFAULT_MODEL,
  getReasoningConfig,
  getValidModelOrDefault,
  resolveEnabledModel,
  type ReasoningEffort,
  type ValidModel,
} from "@open-inspect/shared/models";

export interface ModelPreference {
  model: string;
  reasoningEffort?: string;
}

export interface ResolvedModelPreference {
  model: ValidModel;
  reasoningEffort?: ReasoningEffort;
}

export function resolveModelPreference(
  preference: ModelPreference,
  enabledModels?: readonly string[]
): ResolvedModelPreference {
  const preferredModel = getValidModelOrDefault(preference.model);
  const model = enabledModels
    ? resolveEnabledModel({
        model: preference.model,
        enabledModels,
        fallbackModel: DEFAULT_MODEL,
      })
    : preferredModel;
  const reasoningConfig = getReasoningConfig(model);
  return {
    model,
    reasoningEffort:
      preference.reasoningEffort === undefined
        ? undefined
        : model !== preferredModel
          ? reasoningConfig?.default
          : (reasoningConfig?.efforts.find((effort) => effort === preference.reasoningEffort) ??
            reasoningConfig?.default),
  };
}
