/**
 * RLM command template.
 *
 * The template wraps user arguments in a marker tag that the RLM command
 * preprocessor detects in the chat.message pipeline. The preprocessor:
 *   1. Resolves source handles (file paths, globs, tagged blocks)
 *   2. Calls initRlmSession(...) with the resolved content
 *   3. Replaces this template with the metadata-backed RLM system prompt
 *
 * If the preprocessor does not fire (e.g., RLM disabled), the model sees
 * the fallback instructions below.
 */

export const RLM_COMMAND_TEMPLATE = `You have been invoked via the /rlm command.

The RLM (Recursive Language Model) command offloads context into an out-of-window
variable store and gives you bounded tools to interact with it.

<rlm-command-init>
$ARGUMENTS
</rlm-command-init>

**If you see this text, the RLM preprocessor did not fire.** This means either:
- RLM is disabled in the config (\`experimental.rlm.enabled = false\`)
- The preprocessor hook is not registered

To use RLM manually, read the source files yourself and use the RLM tools
(rlm_probe, rlm_search, rlm_plan, rlm_finish) to interact with the context.`

export const RLM_COMMAND_MARKER = "<rlm-command-init>"
export const RLM_COMMAND_MARKER_END = "</rlm-command-init>"
