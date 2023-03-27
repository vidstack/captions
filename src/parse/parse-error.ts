export const ParseErrorCode = /*#__PURE__*/ {
  LoadFail: 0,
  BadSignature: 1,
  BadTimestamp: 2,
  BadSettingValue: 3,
  UnknownSetting: 4,
} as const;

export type ParseErrorCodes = (typeof ParseErrorCode)[keyof typeof ParseErrorCode];

export class ParseError extends Error {
  readonly code: ParseErrorCodes;
  readonly line: number;
  constructor(init: ParseErrorInit) {
    super(init.reason);
    this.code = init.code;
    this.line = init.line;
  }
}

export interface ParseErrorInit {
  code: ParseErrorCodes;
  reason: string;
  line: number;
}
