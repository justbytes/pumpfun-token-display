import { useState } from 'react';
import Image from 'next/image';
import defaultImageSrc from '../assets/default.png';

interface TokenImageProps {
  src: string;
  alt: string;
  className?: string;
}

export default function TokenImage({ src, alt, className = '' }: TokenImageProps) {
  const [imageError, setImageError] = useState(false);

  // Default placeholder image (you can replace this with your own)
  const defaultImage = defaultImageSrc;

  // Check if URL looks invalid before even trying to load
  const isValidImageUrl = (url: string): boolean => {
    if (!url || url.trim() === '' || url === 'undefined') return false;
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  // Determine which image source to use
  const imageSrc = imageError || !isValidImageUrl(src) ? defaultImage : src;

  return (
    <Image
      src={imageSrc}
      alt={alt}
      fill
      className={`object-cover ${className}`}
      onError={() => {
        // Only set error if we weren't already using the default
        if (!imageError) {
          setImageError(true);
        }
      }}
      // improve loading
      placeholder="blur"
      blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAhEAACAQMDBQAAAAAAAAAAAAABAgMABAUGIWGRkqGx0f/EABUBAQEAAAAAAAAAAAAAAAAAAAMF/8QAGhEAAgIDAAAAAAAAAAAAAAAAAAECEgMRkf/aAAwDAQACEQMRAD8AltJagyeH0AthI5xdrLcNM91BF5pX2HaH9bcfaSXWGaRmknyJckliyjqTzSlT54b6bk+h0R7ysUr/2Q=="
      sizes="80px"
    />
  );
}
