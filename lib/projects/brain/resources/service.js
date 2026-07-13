import { listRegisteredProjectResources } from "./registry.js";

export { registerAcceptedResultAsResource, findReusableResourceForStep, buildResourceDisplayName } from "./registry.js";
export { listRegisteredProjectResources };

export async function getProjectResourcesView(args) {
  return listRegisteredProjectResources(args);
}
