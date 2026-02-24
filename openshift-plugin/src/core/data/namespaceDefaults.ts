/** Prefixes that identify OpenShift/Kubernetes system namespaces */
export const DEFAULT_NAMESPACE_PREFIXES = ['openshift-', 'kube-'];

/** Exact names that are considered system namespaces */
export const DEFAULT_NAMESPACE_NAMES = ['default', 'openshift'];

/** Check if a namespace is a default/system namespace */
export const isDefaultNamespace = (ns: string): boolean =>
  DEFAULT_NAMESPACE_PREFIXES.some(prefix => ns.startsWith(prefix)) ||
  DEFAULT_NAMESPACE_NAMES.includes(ns);

/** Chat scope type — matches backend constants CLUSTER_WIDE / NAMESPACE_SCOPED */
export type ChatScope = 'cluster_wide' | 'namespace_scoped';
