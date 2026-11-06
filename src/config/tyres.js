export const tyreConfig = {
  activeSurface: 'road',
  surfaces: {
    road: {
      front: {
        frictionCoefficient: 1.45,
        loadSensitivityExponent: -0.07,
        minimumLoadScale: 0.72,
        maximumLoadScale: 1.08,
        leanGripLoss: 0.16,
        slideThreshold: 0.98,
      },
      rear: {
        frictionCoefficient: 1.75,
        loadSensitivityExponent: -0.08,
        minimumLoadScale: 0.7,
        maximumLoadScale: 1.08,
        leanGripLoss: 0.2,
        slideThreshold: 0.96,
        slidingGripScale: 0.9,
        maximumDrivenWheelSlipRatio: 0.2,
      },
    },
    dirt: {},
    gravel: {},
  },
};
