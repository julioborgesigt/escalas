import { z } from 'zod';

/** Schema para validação de configurações globais de assinatura */
export const assinaturaConfigSchema = z.object({
	exigirFoto: z.boolean().optional(),
	exigirGps: z.boolean().optional(),
	exigirCodigoEmail: z.boolean().optional(),
	restringirSmartphone: z.boolean().optional()
});
