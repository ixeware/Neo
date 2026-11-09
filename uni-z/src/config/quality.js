// Quality presets (master prompt, section 15)
export const QUALITY = {
  low: { label: 'Низкое', pixelRatio: 1.0, shadows: 0, post: 'none', reflector: false, glassTransmission: false, grilleDensity: 0.4, bloom: false, ao: false, smaa: false },
  medium: { label: 'Среднее', pixelRatio: 1.25, shadows: 1024, post: 'fxaa', reflector: false, glassTransmission: false, grilleDensity: 0.7, bloom: true, ao: false, smaa: false },
  high: { label: 'Высокое', pixelRatio: 1.5, shadows: 2048, post: 'smaa', reflector: true, glassTransmission: false, grilleDensity: 1.0, bloom: true, ao: true, smaa: true },
  ultra: { label: 'Ультра', pixelRatio: 2.0, shadows: 4096, post: 'smaa', reflector: true, glassTransmission: true, grilleDensity: 1.0, bloom: true, ao: true, smaa: true },
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];
