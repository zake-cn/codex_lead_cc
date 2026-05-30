export function buildReviewReport(base) {
    return {
        ...base,
        report_type: "review",
        decision: base.decision ?? "unknown",
        findings: base.findings ?? [],
    };
}
//# sourceMappingURL=build_review_report.js.map