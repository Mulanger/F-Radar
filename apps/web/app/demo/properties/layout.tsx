import { PropertyDetail } from '@/components/properties/PropertyDetail';

/**
 * The detail view lives in the layout (not the page) so it stays mounted when the
 * `[propertyId]` segment changes. That keeps the WebGL context and Leaflet map alive
 * while switching properties (update-in-place, as in the prototype).
 */
export default function PropertiesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PropertyDetail />
      {children}
    </>
  );
}
