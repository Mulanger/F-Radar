import { PropertyDetail } from '@/components/properties/PropertyDetail';

/**
 * The detail view lives in the layout (not the page) so it stays mounted when the
 * `[propertyId]` segment changes. That keeps the WebGL context and Leaflet map alive
 * while switching properties (update-in-place, as in the prototype).
 *
 * The page comes FIRST: it registers the property's full snapshot (`PropertyDetailData`, renders
 * nothing) before `PropertyDetail` renders, so the server HTML already has the whole page.
 */
export default function PropertiesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <PropertyDetail />
    </>
  );
}
