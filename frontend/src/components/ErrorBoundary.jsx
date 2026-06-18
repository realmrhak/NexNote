import { Component } from "react";

/**
 * BUG #3 FIX: Error boundary for the note viewer/editor.
 *
 * The bug report mentioned: "Jab koi member note edit karta hai toh doosra
 * member baad mein woh note open karta hai toh error aata hai ya note open
 * nahi hota". This component catches render-time errors in the editor subtree
 * and shows a friendly fallback instead of leaving the user on a blank white
 * screen with no way back.
 *
 * Usage:
 *   <ErrorBoundary fallback={<EditorErrorFallback />}>
 *     <NoteEditor ... />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log to console for debugging — do NOT swallow, so dev tools still see it.
    console.error("[ErrorBoundary] caught:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) this.props.onReset();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        // Clone the fallback so we can pass the reset handler
        return typeof this.props.fallback === "function"
          ? this.props.fallback({ error: this.state.error, onReset: this.handleReset })
          : this.props.fallback;
      }
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          height: "100vh", fontFamily: "var(--font)", color: "var(--text-secondary)", padding: 24,
          textAlign: "center",
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>😅</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 14, marginBottom: 20, maxWidth: 400 }}>
            We hit an unexpected error loading this note. The note itself is safe —
            please try going back and reopening it.
          </p>
          <button
            onClick={this.handleReset}
            style={{
              padding: "10px 24px", background: "var(--accent)", color: "#fff",
              border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600,
              fontFamily: "var(--font)", fontSize: 14,
            }}
          >
            Go Back
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
