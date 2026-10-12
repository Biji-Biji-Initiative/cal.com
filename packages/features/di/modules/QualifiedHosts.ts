import { getQualifiedHostsService } from "../containers/QualifiedHosts";
import { createModule } from "../di";
import { DI_TOKENS } from "../tokens";

// Availability and booking resolve the same authoritative eligibility service.
export const qualifiedHostsModule = createModule();
qualifiedHostsModule.bind(DI_TOKENS.QUALIFIED_HOSTS_SERVICE).toValue(getQualifiedHostsService());
