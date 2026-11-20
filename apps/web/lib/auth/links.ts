/**
 * Links shown in the sign-in / sign-up footer and the terms checkbox.
 * There are no published terms or privacy pages yet – `null` renders the label without a link.
 * Set the path here once the pages exist.
 */
export const AUTH_LINKS: { terms: string | null; privacy: string | null; dataSources: string } = {
  terms: null,
  privacy: null,
  dataSources: '/#data',
};
