# Demo Walkthrough

This walkthrough demonstrates the intended Phase 3 loop:

```text
scout -> implementer -> tester -> reviewer -> metrics
```

Build first:

```bash
npm install
npm run build
```

For a reproducible walkthrough with the IDs shown below, use a fresh runtime directory:

```bash
export AGENTFOREMAN_HOME=/tmp/codex_lead_cc_demo
```

Create a plan:

```bash
node dist/index.js cc_create_plan --json '{
  "project_id": "demo-project",
  "goal": "Fix the demo project bug and add regression tests.",
  "tasks": [
    {
      "role": "scout",
      "goal": "Analyze project structure and identify the likely bug."
    },
    {
      "role": "implementer",
      "goal": "Fix the bug in an isolated worktree.",
      "depends_on": ["plan_001_step_001"]
    },
    {
      "role": "tester",
      "goal": "Run the demo project tests.",
      "depends_on": ["plan_001_step_002"]
    },
    {
      "role": "reviewer",
      "goal": "Review the generated patch.",
      "depends_on": ["plan_001_step_003"]
    }
  ]
}'
```

Create and assign the scout:

```bash
node dist/index.js cc_create_worker \
  --project-path examples/demo-project \
  --project-id demo-project \
  --role scout

node dist/index.js cc_assign_task \
  --worker-id ccw_001 \
  --plan-id plan_001 \
  --plan-task-id plan_001_step_001 \
  --task "Read the project and report structure, entry points, tests, and likely bug location." \
  --timeout-sec 300
```

After the scout report, update the plan with a reason:

```bash
node dist/index.js cc_update_plan --json '{
  "plan_id": "plan_001",
  "reason": "Scout identified src/hello.py and unittest tests as the relevant implementation and validation path."
}'
```

Create an implementer and assign the bug fix:

```bash
node dist/index.js cc_create_worker \
  --project-path examples/demo-project \
  --project-id demo-project \
  --role implementer

node dist/index.js cc_assign_task \
  --worker-id ccw_002 \
  --plan-id plan_001 \
  --plan-task-id plan_001_step_002 \
  --depends-on task_001 \
  --task "Fix normalize_name so greeting tests pass. Do not commit or merge." \
  --timeout-sec 300
```

Inspect patch artifacts:

```bash
node dist/index.js cc_get_diff_summary --task-id task_002
node dist/index.js cc_get_diff_detail --task-id task_002 --file src/hello.py
```

Create a tester:

```bash
node dist/index.js cc_create_worker \
  --project-path examples/demo-project \
  --project-id demo-project \
  --role tester

node dist/index.js cc_assign_task \
  --worker-id ccw_003 \
  --plan-id plan_001 \
  --plan-task-id plan_001_step_003 \
  --depends-on task_002 \
  --target-task-id task_002 \
  --task "Run python3 -m unittest discover -s tests and report commands_run and test_result." \
  --timeout-sec 300
```

Approve the test command if requested:

```bash
node dist/index.js cc_get_pending_permissions --project-id demo-project
node dist/index.js cc_approve_permission --request-id perm_001 --decision allow_for_task
```

Create a reviewer:

```bash
node dist/index.js cc_create_worker \
  --project-path examples/demo-project \
  --project-id demo-project \
  --role reviewer

node dist/index.js cc_assign_task \
  --worker-id ccw_004 \
  --plan-id plan_001 \
  --plan-task-id plan_001_step_004 \
  --depends-on task_003 \
  --target-task-id task_002 \
  --task "Review the patch from task_002 and return decision, findings, and risks." \
  --timeout-sec 300
```

Watch state and collect metrics:

```bash
node dist/index.js status --project-id demo-project
node dist/index.js cc_get_metrics --project-id demo-project --plan-id plan_001
```

The supervisor summary should be based on reports, events, permissions, diff summaries, review findings, and metrics rather than direct project source reads.
