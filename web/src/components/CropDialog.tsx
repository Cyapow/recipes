import { useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import type { Box1000 } from '../api';

type Area = { x: number; y: number; width: number; height: number };

const toBox = (a: Area): Box1000 => ({
  x0: Math.round(a.x * 10),
  y0: Math.round(a.y * 10),
  x1: Math.round((a.x + a.width) * 10),
  y1: Math.round((a.y + a.height) * 10),
});

/** Lets the user move and resize the dish's box on a card photo. Works with touch (drag, pinch). */
export function CropDialog({ imageId, box, onSave, onCancel }: {
  imageId: string;
  /** The box to start from, in 0-1000 of the image. */
  box: Box1000;
  onSave(box: Box1000): void;
  onCancel(): void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState((box.x1 - box.x0) / Math.max(1, box.y1 - box.y0));
  const area = useRef<Box1000>(box);
  const heading = useRef<HTMLHeadingElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-dialog-title">
      <h2 id="crop-dialog-title" className="crop-dialog-title" tabIndex={-1} ref={heading}>Adjust the dish photo</h2>
      <div className="crop-dialog-area">
        <Cropper
          image={`/api/images/${encodeURIComponent(imageId)}`}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          minZoom={1}
          maxZoom={4}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onMediaLoaded={(m) => {
            const w = (box.x1 - box.x0) * m.naturalWidth;
            const h = (box.y1 - box.y0) * m.naturalHeight;
            if (w > 0 && h > 0) setAspect(w / h);
          }}
          initialCroppedAreaPercentages={{ x: box.x0 / 10, y: box.y0 / 10, width: (box.x1 - box.x0) / 10, height: (box.y1 - box.y0) / 10 }}
          onCropComplete={(percent) => {
            area.current = toBox(percent);
          }}
        />
      </div>
      <p className="hint">Drag to move, pinch or scroll to zoom.</p>
      <div className="crop-dialog-foot">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={() => onSave(area.current)}>Save</button>
      </div>
    </div>
  );
}
