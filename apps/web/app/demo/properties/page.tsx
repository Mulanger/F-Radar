import { redirect } from 'next/navigation';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';

export default function DemoPropertiesIndex() {
  redirect(`/demo/properties/${demoPortfolio.properties[0]!.property.id}`);
}
