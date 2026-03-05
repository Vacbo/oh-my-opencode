import { describe, it, expect } from 'bun:test';
import { buildRlmSystemPrompt } from './system-prompt';

describe('buildRlmSystemPrompt', () => {
  describe('#given canonical mode', () => {
    describe('#when depth=0 and maxDepth=1', () => {
      it('#then includes REPL mental model first', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('Mental Model: REPL-First Interaction');
        expect(prompt).toContain('context variable');
        expect(prompt).toContain('llm_query');
        expect(prompt).toContain('print()');
        expect(prompt).toContain('FINAL(');
        expect(prompt).toContain('FINAL_VAR(');
      });

      it('#then includes all four public tools', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('rlm_probe');
        expect(prompt).toContain('rlm_search');
        expect(prompt).toContain('rlm_plan');
        expect(prompt).toContain('rlm_finish');
      });

      it('#then explains final_var vs rlm_finish distinction', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('final_var');
        expect(prompt).toContain('Halts the current plan');
        expect(prompt).toContain('rlm_finish');
        expect(prompt).toContain('Halts the entire session');
      });

      it('#then includes depth information', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('depth 0');
        expect(prompt).toContain('maxDepth');
      });

      it('#then includes batching guidance', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('Batching Guidance');
        expect(prompt).toContain('batch');
      });

      it('#then explains depth rule for recursion', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('Depth Rule');
        expect(prompt).toContain('downgrade');
        expect(prompt).toContain('plain LM');
      });

      it('#then indicates recursion is not allowed at root with maxDepth=1', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('You cannot request recursive child RLM sessions');
        expect(prompt).toContain('downgrade to plain LM sub-calls');
      });
    });

    describe('#when depth=0 and maxDepth=2', () => {
      it('#then indicates recursion is allowed', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 2,
          mode: 'canonical',
        });

        expect(prompt).toContain('You can request recursive child RLM sessions');
        expect(prompt).toContain('map_rlm');
      });
    });

    describe('#when depth=1 and maxDepth=2', () => {
      it('#then indicates this is a child session', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 1,
          maxDepth: 2,
          mode: 'canonical',
        });

        expect(prompt).toContain('depth 1');
        expect(prompt).toContain('recursion depth 1 of 2');
      });

      it('#then indicates recursion is not allowed at depth 1 with maxDepth=2', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 1,
          maxDepth: 2,
          mode: 'canonical',
        });

        expect(prompt).toContain('You cannot request recursive child RLM sessions');
        expect(prompt).toContain('downgrade to plain LM sub-calls');
      });
    });

    describe('#when contextMetadata is provided', () => {
      it('#then uses custom context variable name', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          contextMetadata: {
            contextVariableName: 'my_context',
          },
          mode: 'canonical',
        });

        expect(prompt).toContain('my_context');
      });

      it('#then defaults to "context" when not provided', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('`context`');
      });
    });

    describe('#when rlm_probe operations are described', () => {
      it('#then includes all six operations', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('head');
        expect(prompt).toContain('tail');
        expect(prompt).toContain('slice');
        expect(prompt).toContain('stats');
        expect(prompt).toContain('schema');
        expect(prompt).toContain('list_vars');
      });
    });

    describe('#when rlm_plan operations are described', () => {
      it('#then includes all eight operations', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('split');
        expect(prompt).toContain('select');
        expect(prompt).toContain('map_llm');
        expect(prompt).toContain('map_rlm');
        expect(prompt).toContain('concat');
        expect(prompt).toContain('reduce_llm');
        expect(prompt).toContain('write_var');
        expect(prompt).toContain('final_var');
      });

      it('#then explains template expansion', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('{{query}}');
        expect(prompt).toContain('{{item}}');
        expect(prompt).toContain('Template Expansion');
      });
    });

    describe('#when rlm_finish is described', () => {
      it('#then explains it is the only terminal tool', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('Unique Terminal Tool');
        expect(prompt).toContain('is the **only** way to end the session');
      });

      it('#then explains it bypasses truncation and distillation', () => {
        const prompt = buildRlmSystemPrompt({
          depth: 0,
          maxDepth: 1,
          mode: 'canonical',
        });

        expect(prompt).toContain('bypasses truncation and distillation');
      });
    });
  });

  describe('#given keyword-alias mode', () => {
    it('#then returns a lightweight prompt', () => {
      const prompt = buildRlmSystemPrompt({
        depth: 0,
        maxDepth: 1,
        mode: 'keyword-alias',
      });

      expect(prompt).toContain('RLM Mode (Lightweight)');
      expect(prompt).toContain('rlm_probe');
      expect(prompt).toContain('rlm_search');
      expect(prompt).toContain('rlm_plan');
      expect(prompt).toContain('rlm_finish');
    });

    it('#then includes a note about /rlm command', () => {
      const prompt = buildRlmSystemPrompt({
        depth: 0,
        maxDepth: 1,
        mode: 'keyword-alias',
      });

      expect(prompt).toContain('/rlm');
      expect(prompt).toContain('paper-faithful');
    });

    it('#then includes current depth and maxDepth', () => {
      const prompt = buildRlmSystemPrompt({
        depth: 0,
        maxDepth: 1,
        mode: 'keyword-alias',
      });

      expect(prompt).toContain('Current depth: 0 / 1');
    });

    it('#then uses custom context variable name', () => {
      const prompt = buildRlmSystemPrompt({
        depth: 0,
        maxDepth: 1,
        contextMetadata: {
          contextVariableName: 'my_context',
        },
        mode: 'keyword-alias',
      });

      expect(prompt).toContain('my_context');
    });
  });

  describe('#given various depth combinations', () => {
    it('#then correctly identifies root vs child sessions', () => {
      const rootPrompt = buildRlmSystemPrompt({
        depth: 0,
        maxDepth: 3,
        mode: 'canonical',
      });

      const childPrompt = buildRlmSystemPrompt({
        depth: 1,
        maxDepth: 3,
        mode: 'canonical',
      });

      expect(rootPrompt).toContain('root level (depth 0)');
      expect(childPrompt).toContain('recursion depth 1 of 3');
    });

    it('#then correctly identifies when recursion is exhausted', () => {
      const exhaustedPrompt = buildRlmSystemPrompt({
        depth: 2,
        maxDepth: 2,
        mode: 'canonical',
      });

      expect(exhaustedPrompt).toContain('You cannot request recursive child RLM sessions');
      expect(exhaustedPrompt).toContain('downgrade to plain LM sub-calls');
    });
  });

  describe('#given prompt structure', () => {
    it('#then canonical prompt is REPL-first, not tool-catalog-first', () => {
      const prompt = buildRlmSystemPrompt({
        depth: 0,
        maxDepth: 1,
        mode: 'canonical',
      });

      const replIndex = prompt.indexOf('Mental Model: REPL-First Interaction');
      const toolIndex = prompt.indexOf('OMO Tool Surface');

      expect(replIndex).toBeLessThan(toolIndex);
      expect(replIndex).toBeGreaterThan(0);
    });

    it('#then includes workflow example', () => {
      const prompt = buildRlmSystemPrompt({
        depth: 0,
        maxDepth: 1,
        mode: 'canonical',
      });

      expect(prompt).toContain('Workflow Example');
      expect(prompt).toContain('Inspect');
      expect(prompt).toContain('Search');
      expect(prompt).toContain('Plan');
      expect(prompt).toContain('Finish');
    });

    it('#then includes key principles', () => {
      const prompt = buildRlmSystemPrompt({
        depth: 0,
        maxDepth: 1,
        mode: 'canonical',
      });

      expect(prompt).toContain('Key Principles');
      expect(prompt).toContain('Symbolic, not literal');
      expect(prompt).toContain('Bounded operations');
      expect(prompt).toContain('Batching');
      expect(prompt).toContain('Deterministic recursion');
      expect(prompt).toContain('Clear terminal');
    });
  });
});
