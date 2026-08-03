/**
 * Five real architectures, written in the text format.
 *
 * Recreations of published designs rather than invented ones — the point is to
 * find out what the library cannot say, and a diagram invented to suit it would
 * never find that out. Each is reduced to the components the sources actually
 * name; a faithful diagram of a real system is more useful than an exhaustive
 * one nobody can read.
 */

export interface Example {
  id: string
  title: string
  source: string
  /** Why this one — what shape it puts the library under. */
  note: string
  dsl: string
}

export const EXAMPLES: Example[] = [
  {
    id: 'netflix',
    title: 'Netflix — streaming control plane',
    source: 'highscalability / Netflix OSS (Zuul, Eureka, EVCache, Open Connect)',
    note: 'Fan-out. One gateway in front of many services, plus a separate CDN path that bypasses the control plane entirely.',
    dsl: `
tv      client   "TV / browser"
phone   mobile   "Mobile app"
oc      cdn      "Open Connect"
assets  blob     "Encoded assets"

elb     balancer "ELB"
zuul    gateway  "Zuul"
eureka  registry "Eureka"

api     service  "API"
play    service  "Playback"
reco    service  "Recommendations"

evcache cache    "EVCache"
cass    database "Cassandra"
keystone stream  "Keystone"
atlas   monitor  "Atlas"

# Video never touches the control plane — that separation is the design.
tv     -> oc
phone  -> oc
oc     => assets

tv     -> elb
phone  -> elb
elb    -> zuul
zuul   -> api
zuul   -> play
api    -> reco

play   ~> evcache
reco   ~> evcache
api    => cass
play   => cass

zuul   -> eureka
api    -> eureka
api    ~> keystone
keystone => atlas

group edge    "Edge tier"     { elb, zuul, eureka }
group svc     "Service tier"  { api, play, reco }
group data    "Data tier"     { evcache, cass }

trace "Start playback" { phone -40-> elb -12-> zuul -25-> play -90-> evcache }
`,
  },

  {
    id: 'uber',
    title: 'Uber — real-time dispatch (DISCO)',
    source: 'highscalability: How Uber Scales Their Real-time Market Platform',
    note: 'Two client populations converging on one matcher, with a geospatial index beside it. Supply and demand are separate services on purpose.',
    dsl: `
rider   mobile   "Rider app"
driver  mobile   "Driver app"

edge    gateway  "API gateway"
disco   service  "DISCO"
supply  service  "Supply"
demand  service  "Demand"
geo     search   "H3 geo index"

loc     cache    "Location cache"
trips   database "Trip store"
events  stream   "Event stream"
maps    external "Maps / ETA"
pay     external "Payments"
watch   monitor  "Telemetry"

rider  -> edge
driver -> edge
edge   -> demand
edge   -> supply

demand -> disco
supply -> disco
disco  -> geo
geo    ~> loc

driver => events
events => loc

disco  -> maps
disco  => trips
trips  ~> pay
disco  ~> watch

group match "Matching" { disco, supply, demand, geo }

trace "Match a rider" { rider -30-> edge -18-> demand -45-> disco -22-> geo }
`,
  },

  {
    id: 'rag',
    title: 'Retrieval-augmented generation',
    source: 'Databricks RAG workflow · IBM vector databases for RAG',
    note: 'Two pipelines that meet at one store: offline ingest writes it, online query reads it. The shape most LLM products actually have.',
    dsl: `
src     blob     "Source documents"
etl     worker   "Chunk + clean"
embed   model    "Embedding model"
vdb     vectordb "Vector store"
kw      search   "Keyword index"

user    client   "User"
app     gateway  "App / API"
orch    service  "Orchestrator"
llm     model    "LLM"
resp    cache    "Response cache"
evals   monitor  "Evals"

# Ingest: offline, and the only writer of the index.
src   => etl
etl   => embed
embed => vdb
etl   => kw

# Query: online, read-only against it.
user  -> app
app   -> orch
orch  ~> resp
orch  -> vdb
orch  -> kw
orch  -> llm
llm   -> orch
orch  ~> evals

group ingest "Ingest pipeline" { etl, embed }
group index  "Retrieval index" { vdb, kw }

# The orchestrator is visited twice: it fans out to retrieval, gets the chunks
# back, and only then calls the model. A trace traverses an edge in either
# direction, so returning through a node it already passed is expressible —
# writing it as a straight line orch → vdb → llm was simply wrong, and the gap
# report is what said so.
trace "Answer a question" { user -20-> app -8-> orch -110-> vdb -15-> orch -1400-> llm }
`,
  },

  {
    id: 'whatsapp',
    title: 'WhatsApp — 1:1 messaging',
    source: 'bytebytego / CometChat: WhatsApp architecture (ejabberd, Mnesia)',
    note: 'A hub. Long-lived connections on both sides of one chat server, with a queue for whoever is offline.',
    dsl: `
a       mobile   "Sender"
b       mobile   "Recipient"

lb      balancer "Load balancer"
gw      gateway  "Socket gateway"
chat    service  "Chat server"
sess    cache    "Session + presence"
mq      queue    "Offline queue"
store   database "Mnesia"
media   blob     "Media store"
push    external "APNs / FCM"
seen    monitor  "Delivery metrics"

a    -> lb
b    -> lb
lb   -> gw
gw   <-> chat
chat ~> sess
chat => store
chat ~> mq
mq   -> push
a    => media
chat ~> seen

group core "Messaging core" { chat, sess, mq }

trace "Deliver a message" { a -35-> lb -6-> gw -14-> chat -40-> store }
`,
  },

  {
    id: 'shortener',
    title: 'URL shortener',
    source: 'AlgoMaster / DesignGurus: design a URL shortener',
    note: 'The small one, deliberately. A 100:1 read-to-write ratio means the cache is the architecture, and a diagram should show that.',
    dsl: `
user    client   "Browser"
lb      balancer "Load balancer"
api     service  "API server"
kgs     service  "Key generation"
keys    database "Key store"
redis   cache    "Redis"
kv      database "URL store"
clicks  stream   "Click events"
dw      warehouse "Analytics"

user -> lb
lb   -> api
api  -> kgs
kgs  => keys
api  ~> redis
redis ~> kv
api  => kv
api  => clicks
clicks => dw

group write "Write path" { kgs, keys }

trace "Redirect a short link" { user -25-> lb -4-> api -2-> redis }
`,
  },
]
