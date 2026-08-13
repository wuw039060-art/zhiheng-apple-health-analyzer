export interface KnowledgeSource {
  id: string;
  title: string;
  organization: string;
  url: string;
  use: string;
}

export const KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  {
    id: "friend-vo2-reference",
    title: "Reference Standards for Cardiorespiratory Fitness Measured With Cardiopulmonary Exercise Testing",
    organization: "FRIEND Registry / Mayo Clinic Proceedings",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4919021/",
    use: "状态年龄中 VO₂ max 的同性别、分年龄人群中位参考曲线",
  },
  {
    id: "apple-cardio-fitness-whitepaper",
    title: "Using Apple Watch to Estimate Cardio Fitness with VO₂ max",
    organization: "Apple",
    url: "https://www.apple.com/in/healthcare/docs/site/Using_Apple_Watch_to_Estimate_Cardio_Fitness_with_VO2_max.pdf",
    use: "Apple Watch VO₂ max 的估算范围、验证误差、适用条件与干扰因素",
  },
  {
    id: "cdc-activity-guidelines",
    title: "Adult Activity: An Overview",
    organization: "U.S. CDC",
    url: "https://www.cdc.gov/physical-activity-basics/guidelines/adults.html",
    use: "每周 150–300 分钟活动目标的行为修正依据",
  },
  {
    id: "cdc-sleep-duration",
    title: "About Sleep",
    organization: "U.S. CDC",
    url: "https://www.cdc.gov/sleep/about/index.html",
    use: "成年人睡眠时长的健康习惯背景；不作疾病诊断",
  },
  {
    id: "apple-heart-rate-recovery",
    title: "Heart Rate Recovery One Minute",
    organization: "Apple Developer / HealthKit",
    url: "https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartraterecoveryoneminute",
    use: "一分钟运动后心率恢复指标的设备定义",
  },
  {
    id: "cole-heart-rate-recovery",
    title: "Heart-rate recovery immediately after exercise as a predictor of mortality",
    organization: "New England Journal of Medicine / PubMed",
    url: "https://pubmed.ncbi.nlm.nih.gov/10536127/",
    use: "心率恢复的预后研究背景；阈值仅适用于对应试验方案",
  },
  {
    id: "apple-watch-hrv-validation",
    title: "Validity of the Apple Watch for Measuring Heart Rate Variability",
    organization: "Sports Medicine International Open / PubMed",
    url: "https://pubmed.ncbi.nlm.nih.gov/30103376/",
    use: "Apple Watch HRV 测量效度及与标准方法不可混用的边界",
  },
  {
    id: "wearable-rhr-population",
    title: "Harnessing wearable device data to improve state-level real-time surveillance of influenza-like illness",
    organization: "The Lancet Digital Health / PubMed Central",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7001906/",
    use: "大规模可穿戴静息心率数据的个体差异与纵向变化背景",
  },
  {
    id: "apple-time-in-daylight",
    title: "Measure your time in daylight with Apple Watch",
    organization: "Apple Support",
    url: "https://support.apple.com/en-ie/guide/watch/apd3ab22534c/watchos",
    use: "环境光传感器估算户外日照时间的设备语义",
  },
  {
    id: "apple-active-energy",
    title: "Active energy burned",
    organization: "Apple Developer / HealthKit",
    url: "https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/activeenergyburned",
    use: "活动能量字段定义；仅作活动负荷背景",
  },
  {
    id: "apple-heart-alerts",
    title: "Heart health notifications on Apple Watch",
    organization: "Apple Support",
    url: "https://support.apple.com/en-us/120276",
    use: "高/低心率通知的设备语义与限制",
  },
  {
    id: "apple-vitals",
    title: "Track your overnight vitals with Apple Watch",
    organization: "Apple Support",
    url: "https://support.apple.com/en-us/120142",
    use: "多项夜间生命体征、个人典型范围及常见影响因素",
  },
  {
    id: "apple-blood-oxygen",
    title: "如何在 Apple Watch 上使用“血氧”App",
    organization: "Apple 支持",
    url: "https://support.apple.com/zh-cn/120358",
    use: "血氧数据的非医疗用途、佩戴与测量局限",
  },
  {
    id: "apple-heart-sensor",
    title: "Monitor your heart rate with Apple Watch",
    organization: "Apple Support",
    url: "https://support.apple.com/en-us/120277",
    use: "光学心率传感器、运动测量频率与可靠性限制",
  },
  {
    id: "aha-tachycardia",
    title: "Tachycardia: Fast Heart Rate",
    organization: "American Heart Association",
    url: "https://www.heart.org/en/health-topics/arrhythmia/about-arrhythmia/tachycardia--fast-heart-rate",
    use: "静息心动过速的可能诱因、症状与就医背景",
  },
  {
    id: "aha-bradycardia",
    title: "Bradycardia: Slow Heart Rate",
    organization: "American Heart Association",
    url: "https://www.heart.org/en/health-topics/arrhythmia/about-arrhythmia/bradycardia--slow-heart-rate",
    use: "睡眠/体能相关低心率、其他可能原因及症状",
  },
  {
    id: "aha-sleep-breathing",
    title: "Sleep-Disordered Breathing and Cardiac Arrhythmias in Adults",
    organization: "American Heart Association",
    url: "https://professional.heart.org/en/science-news/sleep-disordered-breathing-and-cardiac-arrhythmias-in-adults/top-things-to-know",
    use: "睡眠呼吸异常与心律问题的关联背景",
  },
];

export const SAFETY_COPY = {
  emergency:
    "如果同时出现胸痛或胸部压迫感、严重呼吸困难、晕厥/接近晕厥、明显意识改变或卒中征象，请立即联系当地急救；中国大陆可拨打 120。",
  nonDiagnosis:
    "本软件只做趋势筛查和证据整理，不诊断疾病，也不能代替心电图、血压、血液检查或医生面诊。不要根据本软件自行停药或改药。",
  sensor:
    "Apple Watch 的血氧和夜间生命体征用于健康与健身参考；佩戴松动、运动、寒冷、皮肤灌注及数据缺失都可能影响读数。",
};
