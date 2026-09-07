import { C608, midRow, pac, text608, toSCC, type Script608 } from './cea-encode';
import type { TextSample } from './types';

/** Pop-on captions followed by three-row roll-up, as a broadcaster would transmit them. */
export const sccScript: Script608 = [
  [
    1,
    [
      ...C608.RCL,
      ...C608.ENM,
      ...pac(14, { indent: 4 }),
      ...text608('HELLO FROM SCENARIST SCC.'),
      ...pac(15, { indent: 8 }),
      ...midRow('yellow'),
      ...text608('(POP-ON CAPTION)'),
    ],
  ],
  [2.5, C608.EOC],
  [5, C608.EDM],
  [
    5.5,
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
  [7, C608.EOC],
  [10, C608.EDM],
  [11, [...C608.RU3, ...pac(15), ...text608('ROLL-UP CAPTIONS APPEAR')]],
  [13, [...C608.CR, ...text608('ONE ROW AT A TIME')]],
  [15, [...C608.CR, ...text608('AND SCROLL UPWARD')]],
  [17, [...C608.CR, ...text608('AS NEW TEXT ARRIVES.')]],
  [19.5, C608.EDM],
];

export const sccSample: TextSample = {
  kind: 'text',
  id: 'scc',
  name: 'SCC (CEA-608)',
  type: 'scc',
  extension: 'scc',
  duration: 21,
  description:
    'Scenarist SCC byte pairs generated from a caption script: two pop-on captions (row PACs, ' +
    'mid-row colour, italics, underline) and a three-row roll-up sequence.',
  text: toSCC(sccScript),
};
