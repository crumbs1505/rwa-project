// Runs an action with a status label, shows errors, then reloads chain state
export type Run = (label: string, action: () => Promise<unknown>) => Promise<void>;
