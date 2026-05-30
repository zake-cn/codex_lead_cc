export function buildTestReport(base) {
    return {
        ...base,
        report_type: "test",
        test_result: base.test_result ?? (base.exit_code === 0 ? "passed" : "failed"),
        commands_run: base.commands_run ?? [],
        failures: base.failures ?? [],
    };
}
//# sourceMappingURL=build_test_report.js.map