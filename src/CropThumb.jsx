import { useState } from 'react';
import { cropStyle } from './canvas-layout.mjs';

// 從正式立繪裁出一件裝備的位置來當縮圖（真實圖片的一部分，不是另外畫的圖）。
export function CropThumb({ url, crop, aspect = 1, alt = '', className = '' }) {
  const [size, setSize] = useState(null);
  const style = size ? cropStyle(crop, size.width, size.height, aspect) : null;
  return <span className={`crop-thumb ${className}`} style={{ aspectRatio: aspect }}>
    <img src={url} alt={alt} draggable="false" loading="lazy"
      onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      style={style ? { position: 'absolute', maxWidth: 'none', height: 'auto', ...style } : { opacity: 0 }} />
  </span>;
}
