import { redisConfig, redisCommand } from "../lib/redis-rest.js";

const BATCH = [
  { asin:"B0BCNW88H3", title:"OtterBox Defender Cover per iPad 10ª/11ª generazione", category:"Accessori", amazonUrl:"https://www.amazon.it/dp/B0BCNW88H3" },
  { asin:"B0DZXFT8BY", title:"Rowenta Ultimate Experience Air Motion CF8C20E0", category:"Cura della persona", amazonUrl:"https://www.amazon.it/dp/B0DZXFT8BY" },
  { asin:"B0CVNNQZD8", title:"Sharpie Creative Marker Acrilici - 12 pezzi", category:"Cancelleria", amazonUrl:"https://www.amazon.it/dp/B0CVNNQZD8" },
  { asin:"B07M9QKWB5", title:"G-STAR Revend Skinny Jeans uomo", category:"Abbigliamento", amazonUrl:"https://www.amazon.it/dp/B07M9QKWB5" },
  { asin:"B0CHRT5K8Z", title:"ASUS TUF Gaming LC II 240 ARGB", category:"Informatica", amazonUrl:"https://www.amazon.it/dp/B0CHRT5K8Z" },
  { asin:"B0GP24SCNN", title:"Motorola Moto Buds Bass Carbon", category:"Audio", amazonUrl:"https://www.amazon.it/dp/B0GP24SCNN" },
  { asin:"B0FPD5G2NX", title:"Oral-B iO Kids 6+ Disney Stitch", category:"Cura della persona", amazonUrl:"https://www.amazon.it/dp/B0FPD5G2NX" }
];

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(String(req.query?.token||"")!=="mps_7Qf9n4Zc2Lx8bK3p") return res.status(401).json({ok:false,error:"unauthorized"});
  if(!redisConfig()) return res.status(503).json({ok:false,error:"redis_required"});
  const lock=await redisCommand("SET","affareradar:manual-priceless-batch:2026-10-11",new Date().toISOString(),"NX","EX",86400);
  if(lock.result!=="OK") return res.status(409).json({ok:false,error:"batch_already_executed"});
  const secret=process.env.PUBLISH_SECRET;
  const host=req.headers.host;
  if(!secret||!host) return res.status(500).json({ok:false,error:"internal_auth_missing"});
  const protocol=String(req.headers["x-forwarded-proto"]||"https").split(",")[0].trim();
  const target=`${protocol}://${host}/api/auto-publish`;
  const results=[];
  for(const item of BATCH){
    const body={
      ...item,
      dealType:"product_signal",
      source:"manual_verified_amazon_page",
      sourceVerified:true,
      pricelessSignal:true,
      commercialClaimsSuppressed:true,
      humanApprovedPricelessSignal:true,
      suppressPriceDisplay:true,
      reason:"Segnalazione prodotto verificata manualmente su Amazon.it. Prezzo, promozioni e disponibilità vanno controllati direttamente su Amazon.",
      imageUrl:null,
      historicalLow:false,
      prime:false,
      stock:true,
      lastVerifiedAt:new Date().toISOString()
    };
    const r=await fetch(target,{method:"POST",headers:{"Content-Type":"application/json","x-affareradar-secret":secret},body:JSON.stringify(body)});
    const data=await r.json().catch(()=>({}));
    results.push({asin:item.asin,status:r.status,published:data.published===true,decision:data.decision||null,reason:data.reason||null,telegram_message_id:data.telegram_message_id||null,queue:data.queue||null});
  }
  return res.status(200).json({ok:true,count:BATCH.length,results});
}
