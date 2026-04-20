export type ConversionErrorReason =
  | 'missing_density'
  | 'unknown_unit'
  | 'not_convertible'
  | 'invalid_argument';

export class ConversionError extends Error {
  constructor(
    message: string,
    public readonly reason: ConversionErrorReason,
  ) {
    super(message);
    this.name = 'ConversionError';
  }
}
