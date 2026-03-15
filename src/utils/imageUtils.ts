export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}

export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export async function overlayLogo(baseImageSrc: string, logoSrc: string, position: LogoPosition = 'bottom-right'): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject('No canvas context');

    const baseImg = new Image();
    baseImg.crossOrigin = "anonymous";
    baseImg.onload = () => {
      canvas.width = baseImg.width;
      canvas.height = baseImg.height;
      ctx.drawImage(baseImg, 0, 0);

      if (!logoSrc) {
        resolve(canvas.toDataURL('image/png'));
        return;
      }

      const logoImg = new Image();
      logoImg.crossOrigin = "anonymous";
      logoImg.onload = () => {
        // Calculate logo size (max 20% of base image width)
        const maxLogoWidth = canvas.width * 0.2;
        let scale = 1;
        if (logoImg.width > maxLogoWidth) {
          scale = maxLogoWidth / logoImg.width;
        }
        
        const logoWidth = logoImg.width * scale;
        const logoHeight = logoImg.height * scale;

        const padding = canvas.width * 0.05; // 5% padding

        let x = 0;
        let y = 0;

        switch (position) {
          case 'top-left':
            x = padding;
            y = padding;
            break;
          case 'top-right':
            x = canvas.width - logoWidth - padding;
            y = padding;
            break;
          case 'bottom-left':
            x = padding;
            y = canvas.height - logoHeight - padding;
            break;
          case 'bottom-right':
            x = canvas.width - logoWidth - padding;
            y = canvas.height - logoHeight - padding;
            break;
        }

        ctx.drawImage(logoImg, x, y, logoWidth, logoHeight);
        resolve(canvas.toDataURL('image/png'));
      };
      logoImg.onerror = () => reject('Failed to load logo');
      logoImg.src = logoSrc;
    };
    baseImg.onerror = () => reject('Failed to load base image');
    baseImg.src = baseImageSrc;
  });
}
