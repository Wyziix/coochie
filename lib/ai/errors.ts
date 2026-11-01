/** A refusal or failure from the AI functions, with the message to show. */
export class AiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
