import {
  C608,
  CLW,
  DF,
  Direction,
  DLW,
  DSW,
  Edge,
  Effect,
  HDW,
  Justify,
  mergeSchedules,
  midRow,
  Opacity,
  pac,
  PenSize,
  resetSequence,
  RGB,
  scriptToPackets,
  SPA,
  SPC,
  svc,
  SWA,
  text608,
  text708,
  type Script608,
} from './cea-encode';
import type { CCPacket, LiveSample } from './types';

export const LIVE_DURATION = 40;

/**
 * CEA-608 CC1: two pop-on captions, then roll-up, then a final pop-on near the loop end. Pairs
 * go out one per frame, so each entry starts after the previous one has fully transmitted.
 */
function schedule608(): CCPacket[] {
  const script: Script608 = [
    [
      1,
      [
        ...C608.RCL,
        ...C608.ENM,
        ...pac(14, { indent: 4 }),
        ...text608('CEA-608 POP-ON CAPTION'),
        ...pac(15, { indent: 8 }),
        ...midRow('yellow'),
        ...text608('(CHANNEL CC1, LIVE)'),
      ],
    ],
    [2.2, C608.EOC],
    [5, C608.EDM],
    [
      5.2,
      [
        ...C608.RCL,
        ...C608.ENM,
        ...pac(15, { indent: 0 }),
        ...text608('WITH'),
        ...midRow('italics'),
        ...text608('ITALICS'),
        ...midRow('white'),
        ...text608('AND'),
        ...midRow('cyan', true),
        ...text608('UNDERLINE'),
      ],
    ],
    [6.4, C608.EOC],
    [9, C608.EDM],
    [9.5, [...C608.RU3, ...pac(15), ...text608('ROLL-UP CAPTIONS APPEAR')]],
    [11.5, [...C608.CR, ...text608('ONE ROW AT A TIME')]],
    [13.5, [...C608.CR, ...text608('AND SCROLL UPWARD')]],
    [15.5, [...C608.CR, ...text608('AS NEW TEXT ARRIVES,')]],
    [17.5, [...C608.CR, ...text608('TYPED LIVE FROM cc_data.')]],
    [19.5, C608.EDM],
    [
      33,
      [
        ...C608.RCL,
        ...C608.ENM,
        ...pac(15, { indent: 0 }),
        ...text608('THE STREAM LOOPS AT 40 SECONDS'),
      ],
    ],
    [34.2, C608.EOC],
    [38, C608.EDM],
  ];
  return scriptToPackets(script);
}

/** CEA-708 service 1: coloured pens, a wipe, a ticker, pen sizes/edges, and two windows at once. */
function schedule708(): CCPacket[] {
  resetSequence();
  const packets: CCPacket[] = [],
    at = (time: number, data: number[]) => packets.push({ time, triplets: svc(data) });

  // Window 0: top centre, coloured pen runs.
  at(0.5, [
    ...DLW(0xff),
    ...DF({ id: 0, relative: true, av: 8, ah: 50, anchor: 1, rows: 2, cols: 32 }),
    ...SWA(Justify.center, true, { fillOpacity: Opacity.solid, fillColor: RGB.black }),
    ...SPA(false, false, { size: PenSize.standard }),
    ...SPC(RGB.white, RGB.black),
    ...text708('CEA-708 service 1: '),
    ...SPC(RGB.yellow, RGB.black),
    ...text708('pen '),
    ...SPC(RGB.cyan, RGB.black),
    ...text708('colours '),
    ...SPC(RGB.magenta, RGB.black),
    ...text708('per run'),
    ...DSW(0b0000_0001),
  ]);
  at(4.5, [...HDW(0b0000_0001), ...CLW(0b0000_0001)]);

  // Window 1: centred, translucent blue fill, wipe left-to-right (2 rows x 32 columns).
  at(6, [
    ...DF({ id: 1, relative: true, av: 45, ah: 50, anchor: 4, rows: 2, cols: 32 }),
    ...SWA(Justify.center, true, {
      fillOpacity: Opacity.translucent,
      fillColor: RGB.blue,
      borderType: 1,
      borderColor: RGB.skyBlue,
      effect: Effect.wipe,
      effectDirection: Direction.ltr,
      effectSpeed: 4,
    }),
    ...SPA(false, false, { size: PenSize.standard, edge: Edge.uniform }),
    ...SPC(RGB.white, RGB.blue, { bgOpacity: Opacity.transparent, edge: RGB.black }),
    ...text708('Wipe effect (left to right) over a translucent fill'),
    ...DSW(0b0000_0010),
  ]);
  at(10, [...HDW(0b0000_0010), ...DLW(0b0000_0010)]);

  // Window 2: ticker (predefined window style 7) streaming text right to left.
  const ticker =
    'BREAKING: the 708 ticker window streams text right to left across the bottom of the frame ' +
    'and gets a marquee once it closes';
  at(20, [
    ...DF({ id: 2, relative: true, av: 96, ah: 50, anchor: 7, rows: 1, cols: 32, style: 7 }),
    ...SPC(RGB.gold, RGB.black),
    ...text708(ticker.slice(0, 32)),
    ...DSW(0b0000_0100),
  ]);
  for (let i = 32, t = 20.4; i < ticker.length; i += 4, t += 0.4) {
    at(t, text708(ticker.slice(i, i + 4)));
  }
  at(31, [...HDW(0b0000_0100), ...DLW(0b0000_0100)]);

  // Window 3: pen sizes, italics/underline, and edge types.
  at(21, [
    ...DF({ id: 3, relative: true, av: 8, ah: 50, anchor: 1, rows: 3, cols: 32 }),
    ...SWA(Justify.left, true, { fillOpacity: Opacity.transparent }),
    ...SPA(false, false, { size: PenSize.large, edge: Edge.uniform }),
    ...SPC(RGB.white, RGB.black, { bgOpacity: Opacity.transparent, edge: RGB.black }),
    ...text708('Large pen, '),
    ...SPA(true, true, { size: PenSize.standard, edge: Edge.rightDropShadow }),
    ...text708('italic underline, '),
    ...SPA(false, false, { size: PenSize.small, edge: Edge.raised }),
    ...SPC(RGB.green, RGB.black, { bgOpacity: Opacity.transparent, edge: RGB.black }),
    ...text708('small raised pen'),
    ...DSW(0b0000_1000),
  ]);
  at(26, [...HDW(0b0000_1000), ...DLW(0b0000_1000)]);

  // Windows 4 and 5 displayed simultaneously (left and right).
  at(34, [
    ...DF({ id: 4, relative: true, av: 40, ah: 5, anchor: 3, rows: 2, cols: 14 }),
    ...SWA(Justify.left, true, { fillOpacity: Opacity.solid, fillColor: RGB.black }),
    ...SPC(RGB.white, RGB.black),
    ...text708('Window 4 (left, middle)'),
    ...DF({ id: 5, relative: true, av: 40, ah: 95, anchor: 5, rows: 2, cols: 14 }),
    ...SWA(Justify.right, true, {
      fillOpacity: Opacity.solid,
      fillColor: RGB.black,
      effect: Effect.fade,
      effectSpeed: 2,
    }),
    ...SPC(RGB.orange, RGB.black),
    ...text708('Window 5 (right, fades in)'),
    ...DSW(0b0011_0000),
  ]);
  at(38.5, [...HDW(0b0011_0000), ...DLW(0b0011_0000)]);

  return packets;
}

export const ceaLiveSample: LiveSample = {
  kind: 'live',
  id: 'cea-live',
  name: 'CEA-608/708 live stream',
  description:
    'cc_data packets synthesised while the clock runs and fed to CEA608Decoder (CC1 pop-on and ' +
    'roll-up) and CEA708Decoder (windows with pen colours, a wipe, a ticker, pen sizes and edges) ' +
    'in live mode into a CueTrack, so open-ended cues appear before they end.',
  duration: LIVE_DURATION,
  createSchedule: () => mergeSchedules(schedule608(), schedule708()),
};
