/** The privacy page's text. All of it is the product's to write: what the
 *  product collects is a fact about the product, and a policy copied from a
 *  template is a claim nobody checked. */
export interface PrivacyCopy {
  heading: string;
  /** One or two sentences under the heading. HTML allowed. */
  leadHtml: string;
  /** The policy itself, as HTML: `<h2>` sections, paragraphs and lists. */
  bodyHtml: string;
}
