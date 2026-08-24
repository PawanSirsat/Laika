# Demo data

Everything in this folder is **not real**. Each file stands in for an endpoint
that does not exist yet, and each names that endpoint in its header comment.

The rule that makes this safe: **nothing fake is written inline in a component.**
A component imports from here or it renders real data — never both invisibly. So
`grep -rl "src/demo" src/` lists every screen still leaning on a fixture, and
retiring one is a single import change.

Screens that are substantially demo-driven render `<DemoNotice>` so a reader is
never misled into thinking it is working software.
