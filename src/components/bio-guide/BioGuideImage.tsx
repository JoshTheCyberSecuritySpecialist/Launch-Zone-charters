import SmartImage from '../ui/SmartImage';
import {
  BIO_GUIDE_IMAGES,
  type BioGuideImageKey,
} from '../../content/bioluminescence/images';

type BioGuideImageProps = {
  imageKey: BioGuideImageKey;
  className?: string;
};

export default function BioGuideImage({ imageKey, className = '' }: BioGuideImageProps) {
  const img = BIO_GUIDE_IMAGES[imageKey];
  return (
    <figure className={`my-6 overflow-hidden rounded-xl border border-white/10 bg-black/30 ${className}`.trim()}>
      <SmartImage
        src={img.src}
        alt={img.alt}
        className="aspect-[16/9] w-full"
        sizes="(max-width: 768px) 100vw, 720px"
      />
      {img.caption ? (
        <figcaption className="px-4 py-3 text-xs leading-relaxed text-slate-400">{img.caption}</figcaption>
      ) : null}
    </figure>
  );
}
