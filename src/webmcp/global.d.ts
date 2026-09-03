interface Window {
  __YOURWEB_WEBMCP__?: {
    registered: boolean;
    /** Static tools registered on load. */
    count: number;
    /** Tools derived from the saved record types and interactions. */
    derived?: number;
    error?: string;
  };
}
