import { executeStep, type StepRequest } from './protocol';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<StepRequest>) => void) | null;
  postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data }) => scope.postMessage(executeStep(data));
