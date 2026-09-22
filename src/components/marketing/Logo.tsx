import Image from "next/image";

import logo from "@/assets/authority-logo.png";

interface LogoProps {
  /** Height in pixels; width is derived from the source aspect ratio. */
  size?: number;
  className?: string;
}

export function Logo({ size = 32, className = "" }: LogoProps) {
  return (
    <Image
      src={logo}
      alt="Authority"
      height={size}
      width={size}
      priority
      className={`w-auto object-contain ${className}`}
      style={{ height: size }}
    />
  );
}
