// Higgsfield model catalog, built from docs.higgsfield.ai / open.higgsfield.ai pages as returned by a web search index
// (the docs hosts could not be fetched directly when this was written). So every entry is verified: false: re-check
// each against its `source` page (Input JSON Schema) before relying on limits. Any other documented model path can
// still be requested by passing `model_path`; it then gets basic checks only and the unknown-price estimate.
// usd_per_second: owner's Higgsfield API pricing page, mapped only where the model clearly matches.

export type Field = { type?: 'string' | 'integer' | 'number' | 'boolean' | 'array'; enum?: (string | number | boolean)[]; min?: number; max?: number; maxLength?: number; default?: unknown };
export type Model = {
  id: string; name: string; model_path: string;
  kind: 'text-to-video' | 'image-to-video' | 'reference-to-video' | 'text-to-image';
  required: string[]; required_one_of?: string[]; fields: Record<string, Field>;
  usd_per_second?: number; usd_per_image?: number;
  verified: boolean; source: string; notes?: string;
};

const DOCS = 'https://docs.higgsfield.ai/docs/models';
const OPEN = 'https://open.higgsfield.ai/models';
const S25_ASPECT = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
const KLING_ASPECT = ['16:9', '9:16', '1:1'];

export const MODELS: Model[] = [
  // ---- ByteDance Seedance ----
  { id: 'seedance-2.5-t2v', name: 'Seedance 2.5 text to video', model_path: 'bytedance/seedance-2.5/text-to-video', kind: 'text-to-video',
    required: ['prompt'], fields: { prompt: { type: 'string' }, duration: { type: 'integer', min: 4, max: 30, default: 5 },
      resolution: { enum: ['480p', '720p', '1080p'], default: '720p' }, aspect_ratio: { enum: S25_ASPECT, default: '16:9' },
      output_format: { enum: ['mp4', 'mov'], default: 'mp4' }, generate_audio: { type: 'boolean', default: true } },
    usd_per_second: 0.1758, verified: false, source: `${OPEN}/bytedance/seedance-2.5/text-to-video/api-reference`,
    notes: 'The page example also sends bitrate_mode, which its parameter table does not list.' },
  { id: 'seedance-2.5-i2v', name: 'Seedance 2.5 image to video', model_path: 'bytedance/seedance-2.5/image-to-video', kind: 'image-to-video',
    required: ['image_url'], fields: { image_url: { type: 'string' }, end_image_url: { type: 'string' }, prompt: { type: 'string' },
      duration: { type: 'integer', min: 4, max: 30, default: 5 }, resolution: { enum: ['480p', '720p', '1080p'] }, generate_audio: { type: 'boolean' } },
    usd_per_second: 0.1758, verified: false, source: `${OPEN}/bytedance/seedance-2.5/image-to-video/api-reference`,
    notes: 'Duration/resolution limits copied from the text-to-video page; the console pricing lists 480p-720p for this workflow.' },
  { id: 'seedance-2.5-r2v', name: 'Seedance 2.5 reference to video', model_path: 'bytedance/seedance-2.5/reference-to-video', kind: 'reference-to-video',
    required: [], required_one_of: ['image_urls', 'video_urls', 'audio_urls'],
    fields: { prompt: { type: 'string' }, image_urls: { type: 'array', max: 30 }, video_urls: { type: 'array', max: 10 }, audio_urls: { type: 'array', max: 10 },
      duration: { type: 'integer', min: 4, max: 30 }, resolution: { enum: ['480p', '720p', '1080p'] } },
    usd_per_second: 0.2108, verified: false, source: `${DOCS}/seedance-2-5/reference-to-video`, notes: 'Max 50 references in total; asset:// URLs are rejected.' },
  { id: 'seedance-2.0-t2v', name: 'Seedance 2.0 text to video', model_path: 'bytedance/seedance-2.0/text-to-video', kind: 'text-to-video',
    required: ['prompt'], fields: { prompt: { type: 'string' }, duration: { type: 'integer', min: 4, max: 15, default: 5 }, resolution: { type: 'string' },
      aspect_ratio: { type: 'string' }, generate_audio: { type: 'boolean' } },
    usd_per_second: 0.1197, verified: false, source: 'https://higgsfield.ai/higgsfield-api', notes: 'Up to 4K and 15 s per Higgsfield overview; enums not confirmed.' },

  // ---- Kling ----
  { id: 'kling-3.0-turbo-i2v', name: 'Kling 3.0 Turbo image to video', model_path: 'kling-video/v3.0-turbo/image-to-video', kind: 'image-to-video',
    required: ['prompt', 'image_url'], fields: { prompt: { type: 'string', maxLength: 2500 }, image_url: { type: 'string' },
      duration: { type: 'integer', min: 3, max: 15 }, resolution: { enum: ['720p', '1080p'], default: '720p' } },
    usd_per_second: 0.119, verified: false, source: `${DOCS}/kling-3/turbo-image-to-video` },
  { id: 'kling-3.0-std-i2v', name: 'Kling 3.0 Standard image to video', model_path: 'kling-video/v3.0/std/image-to-video', kind: 'image-to-video',
    required: ['image_url'], fields: { prompt: { type: 'string', maxLength: 2500 }, image_url: { type: 'string' }, last_image_url: { type: 'string' },
      duration: { type: 'integer', min: 3, max: 15, default: 5 }, sound: { enum: ['on', 'off'] } },
    usd_per_second: 0.1071, verified: false, source: `${DOCS}/kling-3/standard-image-to-video` },
  { id: 'kling-3.0-std-t2v', name: 'Kling 3.0 Standard text to video', model_path: 'kling-video/v3.0/std/text-to-video', kind: 'text-to-video',
    required: ['prompt'], fields: { prompt: { type: 'string', maxLength: 2500 }, duration: { type: 'integer', min: 3, max: 15, default: 5 },
      aspect_ratio: { enum: KLING_ASPECT, default: '16:9' }, sound: { enum: ['on', 'off'], default: 'on' } },
    verified: false, source: `${DOCS}/kling-3/standard-text-to-video`, notes: 'Owner price list only names Standard for image to video.' },
  { id: 'kling-3.0-pro-t2v', name: 'Kling 3.0 Pro text to video', model_path: 'kling-video/v3.0/pro/text-to-video', kind: 'text-to-video',
    required: ['prompt'], fields: { prompt: { type: 'string', maxLength: 2500 }, duration: { type: 'integer', min: 3, max: 15, default: 5 },
      aspect_ratio: { enum: KLING_ASPECT }, sound: { enum: ['on', 'off'] } },
    usd_per_second: 0.1428, verified: false, source: `${DOCS}/kling-3/pro-text-to-video`,
    notes: 'Also supports multi-shot (1-6 shots, each prompt <= 512 chars, 1-15 s). Duration/aspect copied from Standard.' },
  { id: 'kling-2.6-pro-i2v', name: 'Kling 2.6 Pro image to video', model_path: 'kling-video/v2.6/pro/image-to-video', kind: 'image-to-video',
    required: ['image_url'], fields: { prompt: { type: 'string' }, image_url: { type: 'string' }, aspect_ratio: { enum: KLING_ASPECT } },
    verified: false, source: `${DOCS}/kling-2-6/pro-image-to-video` },

  // ---- Alibaba / Wan / Happy Horse ----
  { id: 'happy-horse-t2v', name: 'Happy Horse text to video', model_path: 'alibaba/happy-horse/text-to-video', kind: 'text-to-video',
    required: ['prompt'], fields: { prompt: { type: 'string' }, duration: { type: 'integer', min: 3, max: 15 }, resolution: { enum: ['720p', '1080p'] } },
    verified: false, source: `${DOCS}/happy-horse-1/text-to-video`, notes: 'Docs page is for Happy Horse 1.0; the 1.1 price ($0.153/s) is not applied because the version match is unclear.' },
  { id: 'wan-3.0-prime-t2v', name: 'Wan 3.0 Prime text to video', model_path: 'alibaba/wan-3.0-prime/text-to-video', kind: 'text-to-video',
    required: ['prompt'], fields: { prompt: { type: 'string' }, seed: { type: 'integer' }, duration: { type: 'integer', min: 2, max: 30, default: 5 },
      resolution: { enum: ['480p', '720p', '1080p'], default: '1080p' } },
    verified: false, source: `${DOCS}/wan-3-prime/text-to-video` },
  { id: 'wan-3.0-prime-i2v', name: 'Wan 3.0 Prime image to video', model_path: 'alibaba/wan-3.0-prime/image-to-video', kind: 'image-to-video',
    required: ['prompt', 'image_url'], fields: { prompt: { type: 'string' }, image_url: { type: 'string' } },
    verified: false, source: `${DOCS}/wan-3-prime/image-to-video` },
  { id: 'wan-3.0-r2v', name: 'Wan 3.0 reference to video', model_path: 'alibaba/wan-3.0/reference-to-video', kind: 'reference-to-video',
    required: [], fields: {}, verified: false, source: `${DOCS}/wan-3/reference-to-video`, notes: 'Input schema not captured; basic checks only.' },
  { id: 'wan-2.7-i2v', name: 'Wan 2.7 image to video', model_path: 'wan/v2.7/image-to-video', kind: 'image-to-video',
    required: ['image_url'], fields: { image_url: { type: 'string' }, prompt: { type: 'string' } },
    verified: false, source: `${DOCS}/wan-2-7/image-to-video` },

  // ---- MiniMax ----
  { id: 'hailuo-2.3-std-t2v', name: 'MiniMax Hailuo 2.3 Standard text to video', model_path: 'minimax/hailuo-2.3/standard/text-to-video', kind: 'text-to-video',
    required: ['prompt'], fields: { prompt: { type: 'string' } },
    verified: false, source: `${DOCS}/hailuo-2-3/standard-text-to-video`, notes: 'Fixed 768p output. Not MiniMax H3, so the H3 price is not applied.' },

  // ---- Images ----
  { id: 'soul-v2-standard', name: 'Higgsfield Soul v2 Standard (text to image)', model_path: 'higgsfield-ai/soul/v2/standard', kind: 'text-to-image',
    required: ['prompt'], fields: { prompt: { type: 'string' }, aspect_ratio: { type: 'string' } },
    verified: false, source: 'https://docs.higgsfield.ai/docs/help/faq' },
  { id: 'flux-kontext-max-t2i', name: 'FLUX Kontext Max text to image', model_path: 'flux-pro/kontext/max/text-to-image', kind: 'text-to-image',
    required: ['prompt'], fields: { prompt: { type: 'string' }, aspect_ratio: { type: 'string' }, seed: { type: 'integer' }, safety_tolerance: { type: 'integer' } },
    verified: false, source: 'https://github.com/higgsfield-ai/higgsfield-js', notes: 'From the official SDK README example; may be dated.' },
];

// Prices from the owner's list that no documented model path above clearly matches (kept so the gap is visible).
export const UNMAPPED_PRICES = {
  'Kling 3.0 4K': 0.357, 'Happy Horse 1.1': 0.153, 'Seedance 2.0 image to video': 0.1197, 'Seedance 2.0 reference to video': 0.1428, 'MiniMax H3': 0.1105,
};
