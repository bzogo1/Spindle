import { DitherField } from "@/components/ui/dither-field"

/* Animated dither fields that sit behind the Lab hero and CTA. */

const labRamp = ["rgba(52, 78, 48, 0.4)", "#8fbb6c", "#dcf7ab"] as const

export function LabHeroField() {
  return (
    <DitherField
      className="lab-dither"
      pattern="horizon"
      color={labRamp}
      dotSize={1.3}
      intensity={0.92}
      speed={0.7}
      fps={30}
    />
  )
}

export function LabCtaField() {
  return (
    <DitherField
      className="lab-dither"
      pattern="glow"
      color={labRamp}
      dotSize={1.4}
      intensity={0.7}
      speed={0.45}
      fps={24}
    />
  )
}
