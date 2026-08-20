import BioluminescencePackageCards from './BioluminescencePackageCards';
import RocketLaunchPackageCards from './RocketLaunchPackageCards';
import SunsetPackageCards from './SunsetPackageCards';
import type { BioPackageId } from '../../lib/bioluminescencePackages';
import type { RocketPackageId } from '../../lib/rocketLaunchPackages';
import type { SunsetPackageId } from '../../lib/sunsetPackages';

export type DirectPackageExperience = 'bio' | 'rocket' | 'sunset';

type Props = {
  experience: DirectPackageExperience;
  onSelect: (packageId: BioPackageId | RocketPackageId | SunsetPackageId) => void;
};

export default function DirectPackageSelector({ experience, onSelect }: Props) {
  if (experience === 'bio') {
    return <BioluminescencePackageCards onSelect={(id) => onSelect(id)} />;
  }
  if (experience === 'rocket') {
    return <RocketLaunchPackageCards onSelect={(id) => onSelect(id)} />;
  }
  return <SunsetPackageCards onSelect={(id) => onSelect(id)} />;
}
