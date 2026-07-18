package io.github.intisy.ai.stub;

import io.github.intisy.ai.shared.routing.ConfigField;
import io.github.intisy.ai.shared.routing.ConfigGroup;
import io.github.intisy.ai.shared.routing.ConfigSchema;
import io.github.intisy.ai.shared.routing.HandlerCtx;
import io.github.intisy.ai.shared.spi.Store;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Canned {@link io.github.intisy.ai.shared.routing.ConfigurableProvider} example for
 * {@link StubProvider}: a small, fixed settings surface mirroring the TS driver's own {@code
 * settings} groups ({@code src/driver.ts}) -- "Response" (response_text/latency_ms/fail_rate) and
 * "Account rotation" (account_selection_strategy) -- persisted under the SAME store key the TS
 * side reads/writes ({@code config/stub-auth.json}; the injected {@link Store} is already rooted
 * at the config folder, so the key here is just the filename, matching {@code ClaudeConfig}'s
 * convention in claude-code-auth).
 *
 * <p>{@code :stub-provider} only {@code compileOnly}s {@code :routing} (keeping its shipped jar
 * thin -- see build.gradle) and has no JsonCodec on its main-sourceSet classpath, so persistence
 * uses the same hand-rolled, dependency-free string building/regex extraction {@link StubProvider}
 * itself uses (e.g. its {@code MODEL_FIELD} regex), scoped to this fixed, known field set --
 * never a generic JSON parser.
 */
final class StubConfig {

    private static final String STORE_KEY = "stub-auth.json";

    private static final List<String> STRATEGY_OPTIONS = Arrays.asList("sticky", "round-robin", "hybrid");

    // Matches src/index.ts's defineConfig("stub-auth", {...}) defaults exactly.
    private static final String DEFAULT_RESPONSE_TEXT =
            "Hello from stub-auth — the core-auth pipeline works end to end.";
    private static final long DEFAULT_LATENCY_MS = 0;
    private static final double DEFAULT_FAIL_RATE = 0;
    private static final String DEFAULT_STRATEGY = "hybrid";

    private static final Pattern RESPONSE_TEXT_FIELD =
            Pattern.compile("\"response_text\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
    private static final Pattern LATENCY_MS_FIELD =
            Pattern.compile("\"latency_ms\"\\s*:\\s*(-?[0-9]+)");
    private static final Pattern FAIL_RATE_FIELD =
            Pattern.compile("\"fail_rate\"\\s*:\\s*(-?[0-9]*\\.?[0-9]+)");
    private static final Pattern STRATEGY_FIELD =
            Pattern.compile("\"account_selection_strategy\"\\s*:\\s*\"([^\"]*)\"");

    private StubConfig() {
    }

    static ConfigSchema schema() {
        ConfigGroup response = new ConfigGroup("Response", Arrays.asList(
                new ConfigField("response_text", "Response text", "text", null, DEFAULT_RESPONSE_TEXT),
                new ConfigField("latency_ms", "Latency (ms)", "number", null, DEFAULT_LATENCY_MS),
                new ConfigField("fail_rate", "Failure rate", "number", null, DEFAULT_FAIL_RATE)
        ));
        ConfigGroup rotation = new ConfigGroup("Account rotation", Arrays.asList(
                new ConfigField("account_selection_strategy", "Account selection", "select",
                        STRATEGY_OPTIONS, DEFAULT_STRATEGY)
        ));
        return new ConfigSchema(Arrays.asList(response, rotation));
    }

    static Map<String, Object> values(HandlerCtx ctx) {
        return mergedValues(readPersisted(ctx));
    }

    /** Persists {@code incoming} (already-typed values, not raw JSON) and returns the merged result. */
    static Map<String, Object> put(HandlerCtx ctx, Map<String, Object> incoming) {
        Map<String, Object> overrides = readPersisted(ctx);
        if (incoming != null) {
            if (incoming.get("response_text") instanceof String) {
                overrides.put("response_text", incoming.get("response_text"));
            }
            Long latency = asLong(incoming.get("latency_ms"));
            if (latency != null) overrides.put("latency_ms", latency);
            Double failRate = asDouble(incoming.get("fail_rate"));
            if (failRate != null) overrides.put("fail_rate", failRate);
            Object strategy = incoming.get("account_selection_strategy");
            // An invalid/unknown enum value is ignored rather than rejecting the whole request,
            // leaving any prior override/default in place (mirrors ClaudeConfig's coerce()).
            if (strategy instanceof String && STRATEGY_OPTIONS.contains(strategy)) {
                overrides.put("account_selection_strategy", strategy);
            }
        }

        Store store = ctx != null ? ctx.store : null;
        if (store != null) {
            store.put(STORE_KEY, serialize(overrides));
        }
        return mergedValues(overrides);
    }

    // --- helpers ---

    private static Map<String, Object> readPersisted(HandlerCtx ctx) {
        Map<String, Object> overrides = new LinkedHashMap<>();
        Store store = ctx != null ? ctx.store : null;
        String raw = store != null ? store.get(STORE_KEY) : null;
        if (raw == null || raw.isEmpty()) return overrides;

        Matcher rt = RESPONSE_TEXT_FIELD.matcher(raw);
        if (rt.find()) overrides.put("response_text", unescape(rt.group(1)));
        Matcher lm = LATENCY_MS_FIELD.matcher(raw);
        if (lm.find()) overrides.put("latency_ms", Long.parseLong(lm.group(1)));
        Matcher fr = FAIL_RATE_FIELD.matcher(raw);
        if (fr.find()) overrides.put("fail_rate", Double.parseDouble(fr.group(1)));
        Matcher st = STRATEGY_FIELD.matcher(raw);
        if (st.find() && STRATEGY_OPTIONS.contains(st.group(1))) {
            overrides.put("account_selection_strategy", st.group(1));
        }
        return overrides;
    }

    private static Map<String, Object> mergedValues(Map<String, Object> overrides) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("response_text", overrides.getOrDefault("response_text", DEFAULT_RESPONSE_TEXT));
        values.put("latency_ms", overrides.getOrDefault("latency_ms", DEFAULT_LATENCY_MS));
        values.put("fail_rate", overrides.getOrDefault("fail_rate", DEFAULT_FAIL_RATE));
        values.put("account_selection_strategy", overrides.getOrDefault("account_selection_strategy", DEFAULT_STRATEGY));
        return values;
    }

    private static String serialize(Map<String, Object> overrides) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> e : overrides.entrySet()) {
            if (!first) sb.append(",");
            first = false;
            sb.append(StubProvider.quote(e.getKey())).append(":");
            Object v = e.getValue();
            sb.append(v instanceof String ? StubProvider.quote((String) v) : String.valueOf(v));
        }
        return sb.append("}").toString();
    }

    private static Long asLong(Object o) {
        return o instanceof Number ? ((Number) o).longValue() : null;
    }

    private static Double asDouble(Object o) {
        return o instanceof Number ? ((Number) o).doubleValue() : null;
    }

    // Reverses only the escapes StubProvider.quote() itself ever produces (\\, \", \n, \r, \t,
    // \\uXXXX) -- sufficient since this class is the only writer of this store key.
    private static String unescape(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 1 < s.length()) {
                char next = s.charAt(++i);
                switch (next) {
                    case '"': sb.append('"'); break;
                    case '\\': sb.append('\\'); break;
                    case 'n': sb.append('\n'); break;
                    case 'r': sb.append('\r'); break;
                    case 't': sb.append('\t'); break;
                    case 'u':
                        sb.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16));
                        i += 4;
                        break;
                    default: sb.append(next);
                }
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }
}
