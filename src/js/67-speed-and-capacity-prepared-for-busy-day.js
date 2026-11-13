  // =====================================================================
  // Speed and capacity (prepared for busy days)
  //
  // Two jobs, both invisible to the visitor:
  //   1. Pictures load only when they are about to come into view, so a
  //      visitor who looks at the first few properties never downloads the
  //      rest. This is the single biggest saving on a busy day.
  //   2. The browser is told early which servers the page will talk to, so
  //      the first screen appears sooner.
