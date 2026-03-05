export interface DynamicKeywordDetector {
  type: string
  pattern: RegExp
  message: string | ((agentName?: string, modelID?: string) => string)
}

const dynamicDetectors: DynamicKeywordDetector[] = []

export function registerDynamicKeywordDetector(detector: DynamicKeywordDetector): void {
  dynamicDetectors.push(detector)
}

export function getDynamicKeywordDetectors(): readonly DynamicKeywordDetector[] {
  return dynamicDetectors
}
