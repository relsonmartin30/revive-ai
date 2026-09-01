const STEPS = [
  {
    n: 1,
    title: "Generate",
    desc: "Create failed payment records from sample data",
    emphasis: false,
  },
  {
    n: 2,
    title: "Analyze",
    desc: "Rules + local DeepSeek-R1 risk note on each",
    emphasis: true,
    aiLabel: "DeepSeek-R1",
  },
  {
    n: 3,
    title: "Recover",
    desc: "Local LLM negotiation on high-value cases",
    emphasis: false,
  },
] as const;

export function PipelineFlow() {
  return (
    <section className="pipeline-flow" aria-label="Recovery pipeline">
      <div className="pipeline-flow__track">
        {STEPS.map((step, i) => (
          <div key={step.n} className="pipeline-flow__segment">
            {i > 0 && (
              <div className="pipeline-flow__connector" aria-hidden>
                <svg className="pipeline-flow__connector-svg" viewBox="0 0 100 4" preserveAspectRatio="none">
                  <line x1="0" y1="2" x2="100" y2="2" className="pipeline-flow__connector-line" />
                </svg>
              </div>
            )}
            <div
              className={`pipeline-flow__node ${step.emphasis ? "pipeline-flow__node--hero" : "pipeline-flow__node--muted"}`}
            >
              <span className="pipeline-flow__step-num">Step {step.n}</span>
              <h3 className="pipeline-flow__title">{step.title}</h3>
              <p className="pipeline-flow__desc">
                {step.emphasis && step.aiLabel ? (
                  <>
                    Rules + local{" "}
                    <span className="pipeline-flow__ai-label">
                      <span className="pipeline-flow__ai-dot" aria-hidden />
                      {step.aiLabel}
                    </span>{" "}
                    risk note on each
                  </>
                ) : (
                  step.desc
                )}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
