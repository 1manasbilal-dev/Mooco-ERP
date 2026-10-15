/**
 * Image Optimizer Utility for Fast Loading & Low Resolution Compression
 * 
 * Automatically downsizes high-resolution images (e.g. 4K/DSLR/Mobile camera photos 5MB-20MB)
 * to crisp, lightweight web-ready assets (~25KB - 60KB) with instant rendering.
 */

export interface OptimizationResult {
  dataUrl: string;
  originalSizeBytes: number;
  optimizedSizeBytes: number;
  originalSizeFormatted: string;
  optimizedSizeFormatted: string;
  savedPercentage: number;
  width: number;
  height: number;
  mimeType: string;
}

export interface OptimizeOptions {
  maxDimension?: number; // Maximum width or height in pixels (default: 500)
  quality?: number;      // Compression quality 0.1 to 1.0 (default: 0.82)
  preferredFormat?: 'image/webp' | 'image/jpeg';
}

export const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

/**
 * Optimizes an uploaded File or Blob to low-weight data URL
 */
export const optimizeImage = async (
  file: File | Blob,
  options: OptimizeOptions = {}
): Promise<OptimizationResult> => {
  const {
    maxDimension = 500,
    quality = 0.82,
    preferredFormat = 'image/webp'
  } = options;

  const originalSizeBytes = file.size;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Failed to read image file'));

    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image data'));

      img.onload = () => {
        try {
          let { width, height } = img;

          // Calculate scaled dimensions while preserving aspect ratio
          if (width > maxDimension || height > maxDimension) {
            if (width >= height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          // Create canvas for compression
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, width);
          canvas.height = Math.max(1, height);

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Canvas 2D context not available');
          }

          // High quality image smoothing
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Draw image scaled
          ctx.drawImage(img, 0, 0, width, height);

          // Try exporting in preferred format (WebP first, fallback to JPEG)
          let outputDataUrl = canvas.toDataURL(preferredFormat, quality);
          let mime = preferredFormat;

          // Some older browsers might ignore webp and return png
          if (preferredFormat === 'image/webp' && !outputDataUrl.startsWith('data:image/webp')) {
            outputDataUrl = canvas.toDataURL('image/jpeg', quality);
            mime = 'image/jpeg';
          }

          // Calculate approximate base64 byte size
          const base64Content = outputDataUrl.split(',')[1] || '';
          const optimizedSizeBytes = Math.round((base64Content.length * 3) / 4);

          const savedBytes = Math.max(0, originalSizeBytes - optimizedSizeBytes);
          const savedPercentage = originalSizeBytes > 0
            ? Math.round((savedBytes / originalSizeBytes) * 100)
            : 0;

          resolve({
            dataUrl: outputDataUrl,
            originalSizeBytes,
            optimizedSizeBytes,
            originalSizeFormatted: formatBytes(originalSizeBytes),
            optimizedSizeFormatted: formatBytes(optimizedSizeBytes),
            savedPercentage,
            width,
            height,
            mimeType: mime
          });
        } catch (err) {
          reject(err);
        }
      };

      img.src = reader.result as string;
    };

    reader.readAsDataURL(file);
  });
};
