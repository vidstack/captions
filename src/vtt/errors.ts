import { ParseError, ParseErrorCode } from '../parse/parse-error';

export const VTTErrorBuilder = {
  _badHeader() {
    return new ParseError({
      code: ParseErrorCode.BadSignature,
      reason: 'missing WEBVTT file header',
      line: 1,
    });
  },
  _badStartTimestamp(startTime: string, line: number) {
    return new ParseError({
      code: ParseErrorCode.BadTimestamp,
      reason: `cue start timestamp \`${startTime}\` is invalid on line ${line}`,
      line,
    });
  },
  _badEndTimestamp(endTime: string, line: number) {
    return new ParseError({
      code: ParseErrorCode.BadTimestamp,
      reason: `cue end timestamp \`${endTime}\` is invalid on line ${line}`,
      line,
    });
  },
  _badRangeTimestamp(startTime: number, endTime: number, line: number) {
    return new ParseError({
      code: ParseErrorCode.BadTimestamp,
      reason: `cue end timestamp \`${endTime}\` is greater than start \`${startTime}\` on line ${line}`,
      line,
    });
  },
  _badCueSetting(name: string, value: string, line: number) {
    return new ParseError({
      code: ParseErrorCode.BadSettingValue,
      reason: `invalid value for cue setting \`${name}\` on line ${line} (value: ${value})`,
      line,
    });
  },
  _unknownCueSetting(name: string, value: string, line: number) {
    return new ParseError({
      code: ParseErrorCode.UnknownSetting,
      reason: `unknown cue setting \`${name}\` on line ${line} (value: ${value})`,
      line,
    });
  },
  _badRegionSetting(name: string, value: string, line: number) {
    return new ParseError({
      code: ParseErrorCode.BadSettingValue,
      reason: `invalid value for region setting \`${name}\` on line ${line} (value: ${value})`,
      line,
    });
  },
  _unknownRegionSetting(name: string, value: string, line: number) {
    return new ParseError({
      code: ParseErrorCode.UnknownSetting,
      reason: `unknown region setting \`${name}\` on line ${line} (value: ${value})`,
      line,
    });
  },
};
