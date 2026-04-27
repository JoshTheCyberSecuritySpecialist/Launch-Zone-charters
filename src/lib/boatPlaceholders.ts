/** Fallback imagery when `image_url` is missing (Fleet cards). */
export function getBoatPlaceholderImage(type: string): string {
  return type === 'premium'
    ? 'https://images.pexels.com/photos/1145434/pexels-photo-1145434.jpeg?auto=compress&cs=tinysrgb&w=800'
    : 'https://images.pexels.com/photos/163236/luxury-yacht-boat-speed-water-163236.jpeg?auto=compress&cs=tinysrgb&w=800';
}
