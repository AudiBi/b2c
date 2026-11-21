import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Code QR dessiné dans le navigateur (aucun service extérieur : le secret de double authentification ne quitte jamais cet écran).
 * Rendu en image SVG (data URL) : aucun script, et net à toutes les tailles.
 */
export function QrCode({ value, size = 220, alt }: { value: string; size?: number; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((svg) => {
        if (alive) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [value]);

  if (failed || !src) return null;
  return <img src={src} width={size} height={size} alt={alt} data-testid="qr-code" style={{ background: '#fff', borderRadius: 8, border: '1px solid #d0d7de' }} />;
}
