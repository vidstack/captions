export enum ParseErrorCode {
  LoadFail = 0,
  BadSignature = 1,
  BadTimestamp = 2,
  BadSettingValue = 3,
  UnknownSetting = 4,
}

export class ParseError extends Error {
  readonly code: ParseErrorCode;
  readonly line: number;
  constructor(init: ParseErrorInit) {
    super(init.reason);
    this.code = init.code;
    this.line = init.line;
  }
}

export interface ParseErrorInit {
  code: ParseErrorCode;
  reason: string;
  line: number;
}
