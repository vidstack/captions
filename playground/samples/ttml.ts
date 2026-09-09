import type { TextSample } from './types';

/** A 24x24 PNG (yellow frame, red X on a dark blue tile) used by the image cue. */
export const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAiUlEQVR4nGP4fzHtPy0xA/0syM6GYw2bihPkYGQz8FpAjiXo+glaQIol2PRiWIBLITmGg8WxWUCqJfjU4rSAWEsIqcFrAUHXEeMAQhbgjDwig5AoC4ixBKc+Yi3AZwlePYPGApoGEU0jmabJlKYZjaZFBU0LO3IMx5sYBrTCIdVwrJbQv9KnEQYAWsuV/JA7vL8AAAAASUVORK5CYII=';

export const ttmlSample: TextSample = {
  kind: 'text',
  id: 'ttml',
  name: 'TTML / IMSC',
  type: 'ttml',
  extension: 'ttml',
  duration: 18,
  description:
    'Regions with displayAlign, referential and inline styles, spans, <set> animations, timed ' +
    'spans, an embedded SMPTE-TT image cue, tts:textOutline, and vertical tbrl writing.',
  text: `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"
    xmlns:tts="http://www.w3.org/ns/ttml#styling"
    xmlns:ttp="http://www.w3.org/ns/ttml#parameter"
    xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    xmlns:smpte="http://www.smpte-ra.org/schemas/2052-1/2010/smpte-tt"
    xml:lang="en" ttp:timeBase="media" ttp:cellResolution="32 15">
  <head>
    <metadata>
      <ttm:title>Playground IMSC sample</ttm:title>
      <ttm:copyright>media-captions</ttm:copyright>
      <smpte:image xml:id="img1" imagetype="PNG" encoding="Base64">${SAMPLE_PNG_BASE64}</smpte:image>
    </metadata>
    <styling>
      <style xml:id="base" tts:fontFamily="proportionalSansSerif" tts:fontSize="80%" tts:color="white" tts:backgroundColor="rgba(0,0,0,0.75)" tts:textAlign="center"/>
      <style xml:id="yellow" tts:color="#ffd166"/>
      <style xml:id="italic" tts:fontStyle="italic"/>
      <style xml:id="outlined" tts:textOutline="black 2px" tts:backgroundColor="transparent" tts:fontWeight="bold"/>
    </styling>
    <layout>
      <region xml:id="bottom" tts:origin="10% 75%" tts:extent="80% 20%" tts:displayAlign="after" style="base"/>
      <region xml:id="top" tts:origin="10% 5%" tts:extent="80% 20%" tts:displayAlign="before" style="base"/>
      <region xml:id="left" tts:origin="5% 30%" tts:extent="40% 40%" tts:displayAlign="center" tts:textAlign="start" style="base"/>
      <region xml:id="imgbox" tts:origin="62% 30%" tts:extent="24% 40%"/>
      <region xml:id="vert" tts:origin="86% 10%" tts:extent="10% 80%" tts:writingMode="tbrl" tts:displayAlign="before" style="base"/>
    </layout>
  </head>
  <body>
    <div>
      <p begin="0s" end="4s" region="bottom">Regions, <span style="yellow">referential spans</span>, and <span style="italic">inline</span> <span tts:textDecoration="underline">styles</span></p>
      <p begin="2s" end="6s" region="top" style="outlined">Top region with tts:textOutline<br/>and a second line</p>
      <p begin="4s" end="8s" region="bottom">Animated with <span>&lt;set&gt;<set begin="0.5s" dur="3s" tts:color="#ff6b6b"/></span> colour change</p>
      <p begin="6s" end="10s" region="left"><span begin="0s">Timed </span><span begin="1s">spans </span><span begin="2s">appear </span><span begin="3s">in sequence</span></p>
      <div begin="8s" end="12s" region="imgbox" smpte:backgroundImage="#img1"/>
      <p begin="8s" end="12s" region="bottom">An embedded PNG image cue is painted in the region to the right</p>
      <p begin="10s" end="14s" region="vert">縦書きのキャプション</p>
      <p begin="12s" end="16s" region="bottom" tts:opacity="0.4"><set begin="0s" dur="2s" tts:opacity="1"/>Opacity animated at the paragraph level; <span tts:fontSize="140%">bigger</span> span</p>
      <p begin="14s" end="18s" region="top" tts:textAlign="end">tts:textAlign="end" on the paragraph</p>
    </div>
  </body>
</tt>
`,
};
