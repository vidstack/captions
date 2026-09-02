/**
 * Shared types and helpers for CEA-608/708 caption data carried in video streams
 * (`cc_data` from ATSC A/53 user data, H.264/H.265 SEI messages, or MP4 samples via hls.js,
 * mux.js, and similar).
 */

/**
 * One `cc_data` triplet. `type` follows CEA-708: 0 = CEA-608 field 1, 1 = CEA-608 field 2,
 * 2 = DTVCC (708) packet continuation, 3 = DTVCC packet start.
 */
export interface CCDataTriplet {
  type: 0 | 1 | 2 | 3;
  data1: number;
  data2: number;
}

/**
 * A group of `cc_data` triplets sharing a presentation time (in seconds).
 */
export interface CCDataPacket {
  time: number;
  triplets: CCDataTriplet[];
}

const GA94 = 0x47413934,
  CC_USER_DATA_TYPE = 0x03;

/**
 * Extracts `cc_data` triplets from an ATSC A/53 `user_data_registered_itu_t_t35` payload
 * (the bytes following the `itu_t_t35_country_code`/provider codes in a SEI message, starting
 * at the `GA94` identifier), or from a raw `cc_data()` structure that starts with the
 * `process_cc_data_flag` byte. Invalid triplets (`cc_valid` = 0) are skipped.
 */
export function parseCCData(bytes: Uint8Array): CCDataTriplet[] {
  let offset = 0;

  if (bytes.length >= 5 && readUint32(bytes, 0) === GA94) {
    if (bytes[4] !== CC_USER_DATA_TYPE) return [];
    offset = 5;
  }

  if (bytes.length < offset + 2) return [];

  const processCCData = (bytes[offset] & 0x40) !== 0,
    count = bytes[offset] & 0x1f,
    triplets: CCDataTriplet[] = [];

  if (!processCCData) return triplets;

  // Skip the flags byte and the `em_data` byte.
  offset += 2;

  for (let i = 0; i < count && offset + 2 < bytes.length; i++, offset += 3) {
    const flags = bytes[offset],
      valid = (flags & 0x04) !== 0,
      type = (flags & 0x03) as CCDataTriplet['type'];
    if (!valid) continue;
    triplets.push({ type, data1: bytes[offset + 1], data2: bytes[offset + 2] });
  }

  return triplets;
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/** Odd-parity strip used by CEA-608 byte pairs. */
export function stripParity(byte: number) {
  return byte & 0x7f;
}
